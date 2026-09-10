import { PaymentMethod, Prisma } from '@prisma/client';
import { seminovosDaTroca } from './seminovos.js';
import { AppError, naoEncontrado } from './core.js';
import { taxaDe, type TaxaDeCartao } from '../shared/taxas.js';
import { taxasDoCartao, unidadeDeVenda } from './sistema.js';
import { db } from './db.js';
import { disponivel, movimentar } from './estoque.js';
import { notificar } from './notificacoes.js';

/**
 * Onde a venda realmente acontece.
 *
 * É o único caminho que baixa estoque por venda — tanto o PDV direto quanto
 * a finalização de uma pré-venda passam por aqui. Concentrar isso num lugar
 * só é o que garante que as duas portas apliquem as mesmas regras: conferir
 * saldo, resolver o aparelho certo, impedir venda duplicada, gerar
 * movimentação.
 */

export interface ItemDaVenda {
  productId: string;
  quantity: number;
  unitPrice: number;
  imei?: string | null;
  serialNumber?: string | null;
  /** Aparelho físico escolhido (produto UNITARIO). */
  deviceId?: string | null;
}

export interface DadosDaVenda {
  itens: ItemDaVenda[];
  unitId: string;
  paymentMethod: PaymentMethod;
  installments?: number;
  pagamentos?: {
    method: PaymentMethod;
    amount: number;
    installments?: number;
    notes?: string | null;
    feePercent?: number | null;
    bandeira?: string | null;
    autorizacao?: string | null;
    destino?: string | null;
  }[];
  acrescimo?: number | null;
  trocaValor?: number | null;
  trocaNova?:
    | {
        modelo: string;
        cor?: string | null;
        armazenamento?: string | null;
        valorAvaliado: number;
      }[]
    | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerDocument?: string | null;
  customerId?: string | null;
  notes?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
  cashierId?: string | null;
  cashierName?: string | null;
  preSaleId?: string | null;
  saleDate?: Date;
}

/** A taxa que vale para a linha: a informada, ou a da tabela da loja. */
function taxaDaLinha(
  tabela: TaxaDeCartao[],
  metodo: string,
  parcelas: number,
  informada: number | null | undefined,
  bandeira?: string | null,
): Prisma.Decimal | null {
  if (metodo !== 'CREDITO') return null;
  const taxa = informada ?? taxaDe(tabela, parcelas, bandeira === 'elo' ? 'elo' : 'padrao');
  return taxa != null ? new Prisma.Decimal(taxa) : null;
}

/** O que sobra depois do desconto da maquininha. */
function liquidoDaLinha(
  tabela: TaxaDeCartao[],
  metodo: string,
  valor: number,
  parcelas: number,
  informada: number | null | undefined,
  bandeira?: string | null,
): Prisma.Decimal {
  if (metodo === 'EM_ABERTO') return new Prisma.Decimal(0);

  const taxa = taxaDaLinha(tabela, metodo, parcelas, informada, bandeira);
  return new Prisma.Decimal(taxa ? valor * (1 - Number(taxa) / 100) : valor);
}

/** Gera o próximo número visível (VD-000001, PV-000001). */
export async function proximoCodigo(nome: string, prefixo: string, tx?: Prisma.TransactionClient): Promise<string> {
  const cliente = tx ?? db;

  const contador = await cliente.sequence.upsert({
    where: { name: nome },
    update: { value: { increment: 1 } },
    create: { name: nome, value: 1 },
  });

  return `${prefixo}-${String(contador.value).padStart(6, '0')}`;
}

/**
 * Impede vender duas vezes o mesmo aparelho. Só olha vendas finalizadas.
 */
export async function conferirIdentificadores(
  itens: ItemDaVenda[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const cliente = tx ?? db;

  const identificadores = itens.flatMap((i) =>
    [i.imei?.trim(), i.serialNumber?.trim()].filter((v): v is string => Boolean(v)),
  );
  if (!identificadores.length) return;

  const jaVendido = await cliente.saleItem.findFirst({
    where: {
      sale: { status: 'FINALIZADA' },
      OR: [{ imei: { in: identificadores } }, { serialNumber: { in: identificadores } }],
    },
    include: { sale: { select: { code: true, saleDate: true } } },
  });

  if (jaVendido) {
    const qual = jaVendido.imei ?? jaVendido.serialNumber;
    throw new AppError(
      `Este produto já foi vendido ou está sendo finalizado em outra venda (${qual} — venda ${jaVendido.sale.code}).`,
      409,
    );
  }
}

type ProdutoBase = { id: string; name: string; costPrice: Prisma.Decimal; tipoControle: 'UNITARIO' | 'QUANTIDADE'; semEstoque: boolean };

/** Resolve o aparelho físico de um item de produto UNITARIO. */
async function resolverAparelho(
  tx: Prisma.TransactionClient,
  item: ItemDaVenda,
  produto: ProdutoBase,
  unitId: string,
): Promise<{ id: string; costPrice: Prisma.Decimal; imei: string | null; serialNumber: string | null }> {
  if (item.quantity !== 1) {
    throw new AppError(`"${produto.name}" é controlado por aparelho: cada linha vende uma unidade.`);
  }

  const chave = item.deviceId
    ? { id: item.deviceId }
    : item.imei?.trim()
      ? { imei: item.imei.trim() }
      : item.serialNumber?.trim()
        ? { serialNumber: item.serialNumber.trim() }
        : null;

  if (!chave) {
    throw new AppError(`Escolha qual aparelho de "${produto.name}" está saindo (por IMEI, série ou da lista).`);
  }

  const aparelho = await tx.deviceUnit.findFirst({
    where: { ...chave, productId: produto.id },
  });

  if (!aparelho) {
    throw new AppError(`Aparelho de "${produto.name}" não encontrado.`, 404);
  }
  if (aparelho.status !== 'EM_ESTOQUE') {
    throw new AppError(
      `O aparelho ${aparelho.imei ?? aparelho.serialNumber ?? ''} de "${produto.name}" não está disponível (${aparelho.status.toLowerCase()}).`,
      409,
    );
  }
  if (aparelho.unitId !== unitId) {
    throw new AppError(`O aparelho de "${produto.name}" não está na unidade da venda. Transfira antes.`);
  }

  return {
    id: aparelho.id,
    costPrice: aparelho.costPrice,
    imei: aparelho.imei,
    serialNumber: aparelho.serialNumber,
  };
}

/**
 * Registra a venda, baixa o estoque e gera as movimentações — numa
 * transação só.
 */
export async function registrarVenda(dados: DadosDaVenda) {
  if (!dados.itens.length) throw new AppError('Inclua ao menos um produto na venda');

  if (dados.pagamentos?.some((p) => p.method === 'EM_ABERTO')) {
    if (!dados.customerName?.trim()) {
      throw new AppError('Para deixar valor em aberto, informe o nome de quem vai pagar.');
    }
    if (!dados.customerPhone?.trim()) {
      throw new AppError('Para deixar valor em aberto, informe o telefone de quem vai pagar.');
    }
  }

  const fixa = await unidadeDeVenda();
  if (fixa) dados = { ...dados, unitId: fixa.id };

  const [unidade, tabela, turno, vendedorCadastrado] = await Promise.all([
    db.unit.findUnique({ where: { id: dados.unitId } }),
    taxasDoCartao(),
    dados.cashierId
      ? db.cashRegister.findFirst({
          where: { cashierId: dados.cashierId, status: 'ABERTO' },
          orderBy: { openedAt: 'desc' },
        })
      : null,
    !dados.sellerName?.trim() && dados.sellerId
      ? db.user.findUnique({ where: { id: dados.sellerId }, select: { name: true } })
      : null,
  ]);

  if (!unidade) throw naoEncontrado('Unidade');

  const resultado = await db.$transaction(async (tx) => {
    await conferirIdentificadores(dados.itens, tx);

    const achados = await tx.product.findMany({
      where: { id: { in: [...new Set(dados.itens.map((i) => i.productId))] } },
      select: { id: true, name: true, costPrice: true, tipoControle: true, semEstoque: true },
    });
    const produtos = new Map(achados.map((p) => [p.id, p]));
    if (dados.itens.some((i) => !produtos.has(i.productId))) throw naoEncontrado('Produto');

    // Resolve aparelhos e monta a lista de itens com custo congelado.
    const itensComCusto: {
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      costPrice: Prisma.Decimal;
      imei: string | null;
      serialNumber: string | null;
      deviceId: string | null;
    }[] = [];

    for (const item of dados.itens) {
      const produto = produtos.get(item.productId)!;

      if (produto.tipoControle === 'UNITARIO') {
        const aparelho = await resolverAparelho(tx, item, produto, dados.unitId);
        itensComCusto.push({
          productId: produto.id,
          productName: produto.name,
          quantity: 1,
          unitPrice: item.unitPrice,
          costPrice: aparelho.costPrice,
          imei: aparelho.imei ?? item.imei?.trim() ?? null,
          serialNumber: aparelho.serialNumber ?? item.serialNumber?.trim() ?? null,
          deviceId: aparelho.id,
        });
      } else {
        itensComCusto.push({
          productId: produto.id,
          productName: produto.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: produto.costPrice,
          imei: item.imei?.trim() ?? null,
          serialNumber: item.serialNumber?.trim() ?? null,
          deviceId: null,
        });
      }
    }

    // Confere saldo dos produtos por quantidade (que não são serviço).
    const porQuantidade = itensComCusto.filter((i) => {
      const p = produtos.get(i.productId)!;
      return p.tipoControle === 'QUANTIDADE' && !p.semEstoque;
    });
    const pedido = new Map<string, number>();
    for (const item of porQuantidade) {
      pedido.set(item.productId, (pedido.get(item.productId) ?? 0) + item.quantity);
    }
    for (const [productId, quantidade] of pedido) {
      const livre = await disponivel(productId, dados.unitId, tx);
      if (livre < quantidade) {
        throw new AppError(
          `Estoque insuficiente na ${unidade.name} para "${produtos.get(productId)!.name}". Disponível: ${livre} unidade(s).`,
        );
      }
    }

    // Cliente: reaproveita pelo telefone/documento/nome, senão cria.
    const nome = dados.customerName?.trim() || null;
    const vendedorNome = dados.sellerName?.trim() || vendedorCadastrado?.name || null;
    let clienteId = dados.customerId ?? null;

    if (!clienteId && (nome || dados.customerPhone || dados.customerDocument)) {
      const existente =
        (dados.customerPhone
          ? await tx.customer.findFirst({ where: { phone: dados.customerPhone } })
          : null) ??
        (dados.customerDocument
          ? await tx.customer.findFirst({ where: { document: dados.customerDocument } })
          : null) ??
        (nome
          ? await tx.customer.findFirst({ where: { name: { equals: nome, mode: 'insensitive' } } })
          : null);

      clienteId =
        existente?.id ??
        (nome
          ? (
              await tx.customer.create({
                data: {
                  name: nome,
                  phone: dados.customerPhone ?? null,
                  document: dados.customerDocument ?? null,
                },
              })
            ).id
          : null);
    }

    const somaDosItens = itensComCusto.reduce(
      (soma, i) => soma.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
      new Prisma.Decimal(0),
    );
    const acrescimo = new Prisma.Decimal(dados.acrescimo ?? 0);
    const total = somaDosItens.add(acrescimo);
    const custo = itensComCusto.reduce(
      (soma, i) => soma.add(i.costPrice.mul(i.quantity)),
      new Prisma.Decimal(0),
    );

    const daTroca = new Prisma.Decimal(
      dados.trocaNova?.length
        ? dados.trocaNova.reduce((s, a) => s + a.valorAvaliado, 0)
        : (dados.trocaValor ?? 0),
    );
    const aReceber = total.minus(daTroca);

    const emDinheiro = dados.pagamentos?.length
      ? dados.pagamentos.map((p) => ({
          method: p.method,
          amount: new Prisma.Decimal(p.amount.toFixed(2)),
          installments: p.installments ?? 1,
          notes: null as string | null,
          destino: p.destino?.trim() || null,
          bandeira: p.method === 'CREDITO' ? (p.bandeira === 'elo' ? 'elo' : 'padrao') : null,
          autorizacao: p.autorizacao?.trim() || null,
          feePercent: taxaDaLinha(tabela, p.method, p.installments ?? 1, p.feePercent, p.bandeira),
          netAmount: liquidoDaLinha(tabela, p.method, p.amount, p.installments ?? 1, p.feePercent, p.bandeira),
        }))
      : aReceber.greaterThan(0)
        ? [
            {
              method: dados.paymentMethod,
              amount: aReceber,
              installments: dados.installments ?? 1,
              notes: null as string | null,
              destino: null as string | null,
              bandeira: null as string | null,
              autorizacao: null as string | null,
              feePercent: taxaDaLinha(tabela, dados.paymentMethod, dados.installments ?? 1, null),
              netAmount: liquidoDaLinha(tabela, dados.paymentMethod, Number(aReceber), dados.installments ?? 1, null),
            },
          ]
        : [];

    const somaEmDinheiro = emDinheiro.reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0));
    if (somaEmDinheiro.minus(aReceber).abs().greaterThan('0.005')) {
      throw new AppError(
        `As formas de pagamento somam R$ ${somaEmDinheiro.toFixed(2)}, mas o cliente tem a pagar R$ ${aReceber.toFixed(2)}.`,
      );
    }

    const rateio = daTroca.greaterThan(0)
      ? [
          ...emDinheiro,
          {
            method: 'TROCA' as PaymentMethod,
            amount: daTroca,
            installments: 1,
            notes: null,
            destino: null,
            bandeira: null,
            autorizacao: null,
            feePercent: null,
            netAmount: daTroca,
          },
        ]
      : emDinheiro;

    const formaPrincipal =
      emDinheiro.reduce<(typeof emDinheiro)[number] | null>(
        (maior, p) => (!maior || p.amount.greaterThan(maior.amount) ? p : maior),
        null,
      )?.method ?? ('TROCA' as PaymentMethod);

    const venda = await tx.sale.create({
      data: {
        code: await proximoCodigo('venda', 'VD', tx),
        totalAmount: total,
        costAmount: custo,
        surcharge: acrescimo,
        paymentMethod: formaPrincipal,
        installments: dados.installments ?? 1,
        payments: { create: rateio.map(({ notes, ...p }) => ({ ...p, notes })) },
        saleDate: dados.saleDate ?? new Date(),
        notes: dados.notes ?? null,
        unitId: dados.unitId,
        customerId: clienteId,
        customerName: nome,
        customerPhone: dados.customerPhone ?? null,
        customerDocument: dados.customerDocument ?? null,
        sellerId: dados.sellerId ?? null,
        sellerName: vendedorNome,
        cashierId: dados.cashierId ?? null,
        cashRegisterId: turno?.id ?? null,
        preSaleId: dados.preSaleId ?? null,
      },
      include: {
        unit: { select: { name: true } },
        seller: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
    });

    // Itens criados um a um: preciso do id de cada um para amarrar o aparelho.
    for (const item of itensComCusto) {
      const linha = await tx.saleItem.create({
        data: {
          saleId: venda.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: new Prisma.Decimal(item.unitPrice),
          costPrice: item.costPrice,
          imei: item.imei,
          serialNumber: item.serialNumber,
        },
      });

      await movimentar({
        produtoId: item.productId,
        produtoNome: item.productName,
        unidadeId: dados.unitId,
        tipo: 'SAIDA',
        motivo: 'VENDA',
        quantidade: item.quantity,
        observacao:
          `Venda ${venda.code} para ${nome ?? 'consumidor não identificado'}` +
          (item.imei ? ` · IMEI ${item.imei}` : '') +
          (item.serialNumber ? ` · série ${item.serialNumber}` : ''),
        vendaId: venda.id,
        usuarioId: dados.cashierId ?? dados.sellerId,
        usuarioNome: dados.cashierName,
        deviceIds: item.deviceId ? [item.deviceId] : undefined,
        tx,
      });

      if (item.deviceId) {
        await tx.deviceUnit.update({
          where: { id: item.deviceId },
          data: { saleItemId: linha.id },
        });
      }
    }

    // Seminovo cujo último aparelho saiu: arquiva o produto.
    const idsUnitarios = [
      ...new Set(itensComCusto.filter((i) => i.deviceId).map((i) => i.productId)),
    ];
    if (idsUnitarios.length) {
      const seminovosVendidos = await tx.product.findMany({
        where: { id: { in: idsUnitarios }, seminovo: true, status: 'EM_ESTOQUE' },
        select: { id: true, _count: { select: { devices: { where: { status: 'EM_ESTOQUE' } } } } },
      });
      const acabaram = seminovosVendidos.filter((p) => p._count.devices === 0).map((p) => p.id);
      if (acabaram.length) {
        await tx.product.updateMany({ where: { id: { in: acabaram } }, data: { status: 'VENDIDO' } });
      }
    }

    // Troca anotada no balcão vira registro + aparelhos no estoque.
    if (dados.trocaNova?.length) {
      const entregues = dados.trocaNova;
      const primeiro = entregues[0];

      const troca = await tx.tradeIn.create({
        data: {
          code: await proximoCodigo('troca', 'TR', tx),
          status: 'ACEITA',
          modelo:
            entregues.length === 1
              ? primeiro.modelo
              : `${primeiro.modelo} + ${entregues.length - 1} aparelho${entregues.length > 2 ? 's' : ''}`,
          cor: entregues.length === 1 ? (primeiro.cor ?? null) : null,
          armazenamento: entregues.length === 1 ? (primeiro.armazenamento ?? null) : null,
          valorAvaliado: daTroca,
          valorSaida: total,
          customerName: nome ?? 'Consumidor',
          customerPhone: dados.customerPhone ?? null,
          customerDocument: dados.customerDocument ?? null,
          sellerId: dados.sellerId ?? dados.cashierId!,
          unitId: dados.unitId,
          saleId: venda.id,
          defeitos: [],
          aparelhos: {
            create: entregues.map((a, i) => ({
              ordem: i,
              modelo: a.modelo,
              cor: a.cor ?? null,
              armazenamento: a.armazenamento ?? null,
              valorAvaliado: new Prisma.Decimal(a.valorAvaliado),
              defeitos: [],
            })),
          },
        },
      });

      await seminovosDaTroca(troca.id, dados.unitId, dados.cashierId ?? null, tx);
    }

    return { venda, itens: itensComCusto };
  });

  if (dados.sellerId && dados.sellerId !== dados.cashierId) {
    await notificar({
      userId: dados.sellerId,
      title: `Venda ${resultado.venda.code} finalizada`,
      message: `${dados.customerName?.trim() || 'Consumidor'} · ${resultado.itens.length} item(ns) · R$ ${Number(resultado.venda.totalAmount).toFixed(2)}`,
      link: '/minhas-vendas',
    });
  }

  // Devolve num formato próximo ao da referência (`venda` + `items`).
  return Object.assign(resultado.venda, {
    items: resultado.itens.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      imei: i.imei,
      serialNumber: i.serialNumber,
    })),
  });
}
