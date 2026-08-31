import { DeviceStatus, MovementReason, MovementType, Prisma } from '@prisma/client';
import { AppError } from './core';
import { db } from './db';
import { enviarParaPlanilha, planilhaConfigurada } from './planilha';

/**
 * Todo movimento de estoque passa por aqui.
 *
 * Regras que o resto do sistema depende:
 *
 * 1. O saldo de cada unidade é independente — a Loja e o Estoque nunca se
 *    misturam.
 * 2. O estoque nunca fica negativo. Para produto QUANTIDADE a conferência e
 *    a baixa acontecem na mesma instrução SQL. Para produto UNITARIO, cada
 *    aparelho é uma linha (DeviceUnit) e a transição de status é atômica —
 *    duas vendas não conseguem levar o mesmo aparelho.
 * 3. Para produto UNITARIO, `Stock.quantity` de uma unidade é sempre o
 *    número de DeviceUnit com status EM_ESTOQUE ali. Recalculado dentro da
 *    mesma transação a cada mudança.
 */

export const MOTIVO_LABEL: Record<MovementReason, string> = {
  COMPRA: 'Compra',
  CADASTRO: 'Cadastro de produto',
  VENDA: 'Venda',
  DEFEITO: 'Produto com defeito',
  DEVOLUCAO_FORNECEDOR: 'Devolução ao fornecedor',
  PERDA: 'Perda',
  USO_INTERNO: 'Uso interno',
  AJUSTE: 'Ajuste de estoque',
  TRANSFERENCIA: 'Transferência',
  RETIRADA: 'Retirada para a loja',
  CANCELAMENTO: 'Cancelamento',
  EXCLUSAO: 'Exclusão',
  OUTRO: 'Outro',
};

export const TIPO_LABEL: Record<MovementType, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  TRANSFERENCIA: 'Transferência',
  AJUSTE: 'Ajuste',
};

export const STATUS_PRODUTO_LABEL: Record<string, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  VENDIDO: 'Vendido',
};

export const STATUS_APARELHO_LABEL: Record<string, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EM_TRANSITO: 'Em trânsito',
  VENDIDO: 'Vendido',
  DEFEITO: 'Com defeito',
  DEVOLVIDO: 'Devolvido',
};

/** Motivos que o usuário pode escolher numa saída manual. */
export const MOTIVOS_DE_SAIDA: MovementReason[] = [
  'VENDA',
  'DEFEITO',
  'DEVOLUCAO_FORNECEDOR',
  'PERDA',
  'USO_INTERNO',
  'AJUSTE',
  'OUTRO',
];

type Cliente = Prisma.TransactionClient | typeof db;

// ------------------------------------------------------------------- Saldos

/** Saldo atual de um produto numa unidade (0 se nunca teve). */
export async function saldo(produtoId: string, unidadeId: string, tx?: Cliente): Promise<number> {
  const linha = await (tx ?? db).stock.findUnique({
    where: { productId_unitId: { productId: produtoId, unitId: unidadeId } },
    select: { quantity: true },
  });
  return linha?.quantity ?? 0;
}

/** Quanto está comprometido com retiradas pendentes numa unidade. */
export async function reservado(produtoId: string, unidadeId: string, tx?: Cliente): Promise<number> {
  const soma = await (tx ?? db).stockWithdrawal.aggregate({
    where: { productId: produtoId, unitId: unidadeId, status: 'PENDENTE' },
    _sum: { quantity: true },
  });
  return soma._sum.quantity ?? 0;
}

/** Saldo livre para vender: o que existe menos o que está reservado. */
export async function disponivel(produtoId: string, unidadeId: string, tx?: Cliente): Promise<number> {
  const [total, reserva] = await Promise.all([
    saldo(produtoId, unidadeId, tx),
    reservado(produtoId, unidadeId, tx),
  ]);
  return Math.max(0, total - reserva);
}

/**
 * A categoria pedida e as suas subcategorias.
 *
 * Vive aqui porque relatórios, vendas e movimentações precisam da mesma
 * regra: pedir "Smartphones" tem de trazer "Smartphones › Vitrine" junto.
 */
export async function comAsFilhas(categoryId: string): Promise<string[]> {
  const filhas = await db.category.findMany({ where: { parentId: categoryId }, select: { id: true } });
  return [categoryId, ...filhas.map((f) => f.id)];
}

export async function saldoTotal(produtoId: string, tx?: Cliente): Promise<number> {
  const soma = await (tx ?? db).stock.aggregate({
    where: { productId: produtoId },
    _sum: { quantity: true },
  });
  return soma._sum.quantity ?? 0;
}

export async function saldosDoProduto(produtoId: string) {
  const [unidades, linhas, retiradas] = await Promise.all([
    db.unit.findMany({ where: { active: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    db.stock.findMany({ where: { productId: produtoId } }),
    db.stockWithdrawal.groupBy({
      by: ['unitId'],
      where: { productId: produtoId, status: 'PENDENTE' },
      _sum: { quantity: true },
    }),
  ]);

  return unidades.map((unidade) => {
    const quantidade = linhas.find((l) => l.unitId === unidade.id)?.quantity ?? 0;
    const reserva = retiradas.find((r) => r.unitId === unidade.id)?._sum.quantity ?? 0;

    return {
      unitId: unidade.id,
      unitName: unidade.name,
      quantity: quantidade,
      reserved: reserva,
      available: Math.max(0, quantidade - reserva),
    };
  });
}

// --------------------------------------------------------------- Aparelhos

/** Recalcula o saldo de um produto UNITARIO numa unidade a partir dos aparelhos. */
export async function sincronizarSaldoUnitario(
  produtoId: string,
  unidadeId: string,
  tx: Cliente,
): Promise<number> {
  const total = await tx.deviceUnit.count({
    where: { productId: produtoId, unitId: unidadeId, status: 'EM_ESTOQUE' },
  });

  await tx.stock.upsert({
    where: { productId_unitId: { productId: produtoId, unitId: unidadeId } },
    update: { quantity: total },
    create: { productId: produtoId, unitId: unidadeId, quantity: total },
  });

  return total;
}

/** Custo médio dos aparelhos em estoque de um produto UNITARIO. */
export async function custoMedioDosAparelhos(produtoId: string, tx: Cliente): Promise<number> {
  const dados = await tx.deviceUnit.aggregate({
    where: { productId: produtoId, status: 'EM_ESTOQUE' },
    _avg: { costPrice: true },
  });
  return dados._avg.costPrice ? Number(dados._avg.costPrice) : 0;
}

// -------------------------------------------------------------- Movimentação

interface Movimento {
  produtoId: string;
  produtoNome: string;
  unidadeId: string;
  custoUnitario?: number | null;
  tipo: MovementType;
  motivo: MovementReason;
  /** Sempre positiva. Quem decide o sinal é o `sentido`. */
  quantidade: number;
  sentido?: 'entra' | 'sai';
  observacao?: string | null;
  usuarioId?: string | null;
  usuarioNome?: string | null;
  origemId?: string | null;
  destinoId?: string | null;
  vendaId?: string | null;
  transferenciaId?: string | null;
  referenciaId?: string | null;
  tx?: Prisma.TransactionClient;
  semPlanilha?: boolean;
  ignorarReserva?: boolean;
  withdrawalId?: string | null;
  /**
   * Aparelhos afetados (produto UNITARIO). `quantidade` precisa ser
   * exatamente o tamanho desta lista.
   */
  deviceIds?: string[];
  /** Status que os aparelhos assumem numa saída. Padrão deduzido do motivo. */
  statusDoDevice?: DeviceStatus;
}

/** Status que um aparelho assume numa saída, conforme o motivo. */
function statusPorMotivo(motivo: MovementReason): DeviceStatus {
  if (motivo === 'VENDA') return 'VENDIDO';
  if (motivo === 'DEFEITO') return 'DEFEITO';
  if (motivo === 'DEVOLUCAO_FORNECEDOR') return 'DEVOLVIDO';
  if (motivo === 'TRANSFERENCIA') return 'EM_TRANSITO';
  return 'DEVOLVIDO';
}

/**
 * Aplica o movimento no saldo da unidade e registra no histórico.
 * Devolve o saldo antes e depois.
 */
export async function movimentar(m: Movimento): Promise<{ antes: number; depois: number; id: string }> {
  const cliente = m.tx ?? db;

  if (m.quantidade <= 0) {
    throw new AppError('A quantidade precisa ser maior que zero.');
  }

  const entra = m.sentido ? m.sentido === 'entra' : m.tipo === 'ENTRADA';

  if (!m.sentido && m.tipo !== 'ENTRADA' && m.tipo !== 'SAIDA') {
    throw new AppError(`Movimentação do tipo ${m.tipo} precisa informar o sentido.`, 500);
  }

  const comAparelhos = Boolean(m.deviceIds?.length);
  if (comAparelhos && m.deviceIds!.length !== m.quantidade) {
    throw new AppError('A quantidade não bate com o número de aparelhos informados.', 500);
  }

  const antes = await saldo(m.produtoId, m.unidadeId, cliente);
  let depois: number;

  if (comAparelhos) {
    // -------- produto UNITARIO: mexe nos aparelhos e recalcula o saldo
    if (entra) {
      await cliente.deviceUnit.updateMany({
        where: { id: { in: m.deviceIds! } },
        data: { status: 'EM_ESTOQUE', unitId: m.unidadeId },
      });
    } else {
      const novo = m.statusDoDevice ?? statusPorMotivo(m.motivo);
      for (const id of m.deviceIds!) {
        const alterou = await cliente.deviceUnit.updateMany({
          where: {
            id,
            unitId: m.unidadeId,
            status: { in: ['EM_ESTOQUE', 'RESERVADO'] },
          },
          data: { status: novo, ...(novo === 'VENDIDO' ? {} : {}) },
        });
        if (alterou.count === 0) {
          throw new AppError(
            'Um dos aparelhos já saiu do estoque. Confira a lista e tente de novo.',
            409,
          );
        }
      }
    }
    depois = await sincronizarSaldoUnitario(m.produtoId, m.unidadeId, cliente);
  } else {
    // -------- produto QUANTIDADE: conferência + baixa na mesma instrução
    const soma = entra ? m.quantidade : -m.quantidade;

    if (soma < 0) {
      const reserva = m.ignorarReserva ? 0 : await reservado(m.produtoId, m.unidadeId, cliente);
      const livre = antes - reserva;

      if (livre < m.quantidade) {
        const unidade = await cliente.unit.findUnique({ where: { id: m.unidadeId } });
        const nome = unidade?.name ?? 'unidade';

        throw new AppError(
          reserva > 0
            ? `Estoque insuficiente na ${nome}. Disponível: ${Math.max(0, livre)} unidade(s) — ` +
              `${reserva} estão reservadas para retiradas pendentes.`
            : `Estoque insuficiente na ${nome}. Estoque disponível: ${antes} unidade(s).`,
        );
      }
    }

    if (soma > 0) {
      const linha = await cliente.stock.upsert({
        where: { productId_unitId: { productId: m.produtoId, unitId: m.unidadeId } },
        update: { quantity: { increment: soma } },
        create: { productId: m.produtoId, unitId: m.unidadeId, quantity: soma },
      });
      depois = linha.quantity;
    } else {
      const alterou = await cliente.stock.updateMany({
        where: { productId: m.produtoId, unitId: m.unidadeId, quantity: { gte: m.quantidade } },
        data: { quantity: { decrement: m.quantidade } },
      });

      if (alterou.count === 0) {
        throw new AppError('O estoque mudou durante a operação. Confira o saldo e tente de novo.', 409);
      }
      depois = antes - m.quantidade;
    }
  }

  const registro = await cliente.stockMovement.create({
    data: {
      type: m.tipo,
      reason: m.motivo,
      quantity: m.quantidade,
      previousQuantity: antes,
      newQuantity: depois,
      unitCost: m.custoUnitario != null ? new Prisma.Decimal(m.custoUnitario) : null,
      deviceId: m.deviceIds?.length === 1 ? m.deviceIds[0] : null,
      notes: m.observacao ?? null,
      productId: m.produtoId,
      productName: m.produtoNome,
      unitId: m.unidadeId,
      originUnitId: m.origemId ?? null,
      destinationUnitId: m.destinoId ?? null,
      referenceId: m.referenciaId ?? m.vendaId ?? m.transferenciaId ?? null,
      saleId: m.vendaId ?? null,
      transferId: m.transferenciaId ?? null,
      withdrawalId: m.withdrawalId ?? null,
      userId: m.usuarioId ?? null,
    },
  });

  if (!m.semPlanilha) {
    void enviarLinha(registro.id, m, antes, depois, entra);
  }

  return { antes, depois, id: registro.id };
}

/** Monta e dispara a linha da planilha do Google. */
async function enviarLinha(
  movimentoId: string,
  m: Movimento,
  antes: number,
  depois: number,
  entra: boolean,
): Promise<void> {
  if (!planilhaConfigurada()) return;

  try {
    const [produto, unidade, origem, destino] = await Promise.all([
      db.product.findUnique({
        where: { id: m.produtoId },
        include: { category: true, supplier: true },
      }),
      db.unit.findUnique({ where: { id: m.unidadeId } }),
      m.origemId ? db.unit.findUnique({ where: { id: m.origemId } }) : null,
      m.destinoId ? db.unit.findUnique({ where: { id: m.destinoId } }) : null,
    ]);

    enviarParaPlanilha({
      data: new Date(),
      produto: m.produtoNome,
      categoria: produto?.category?.name ?? '—',
      unidade: unidade?.name ?? '—',
      tipo: TIPO_LABEL[m.tipo],
      quantidade: entra ? m.quantidade : -m.quantidade,
      estoqueAnterior: antes,
      estoquePosterior: depois,
      origem: origem?.name ?? '',
      destino: destino?.name ?? '',
      usuario: m.usuarioNome ?? '',
      motivo: MOTIVO_LABEL[m.motivo],
      observacao: m.observacao ?? '',
      movimentoId,
    });
  } catch (erro) {
    console.error('[planilha] não consegui montar a linha:', (erro as Error).message);
  }
}

// ------------------------------------------------------------ Transferência

interface Transferencia {
  produtoId: string;
  origemId: string;
  destinoId: string;
  quantidade: number;
  /** Aparelhos escolhidos (produto UNITARIO). */
  deviceIds?: string[];
  observacao?: string | null;
  usuarioId?: string | null;
  usuarioNome?: string | null;
}

/**
 * Move estoque entre unidades. Origem e destino são atualizados na mesma
 * transação, ligados por duas movimentações que apontam para o mesmo
 * registro de transferência.
 */
export async function transferir(t: Transferencia) {
  if (t.origemId === t.destinoId) {
    throw new AppError('A unidade de origem e a de destino precisam ser diferentes.');
  }

  return db.$transaction(async (tx) => {
    const [produto, origem, destino] = await Promise.all([
      tx.product.findUnique({ where: { id: t.produtoId } }),
      tx.unit.findUnique({ where: { id: t.origemId } }),
      tx.unit.findUnique({ where: { id: t.destinoId } }),
    ]);

    if (!produto) throw new AppError('Produto não encontrado', 404);
    if (!origem || !destino) throw new AppError('Unidade não encontrada', 404);

    const transferencia = await tx.stockTransfer.create({
      data: {
        productId: produto.id,
        originUnitId: origem.id,
        destinationUnitId: destino.id,
        quantity: t.quantidade,
        status: 'RECEBIDA',
        receivedAt: new Date(),
        requestedById: t.usuarioId ?? null,
        receivedById: t.usuarioId ?? null,
        notes: t.observacao ?? null,
      },
    });

    // Aparelhos: mudam de unidade direto (sem passar por "em trânsito"
    // porque o recebimento é imediato).
    if (produto.tipoControle === 'UNITARIO') {
      const ids = t.deviceIds ?? [];
      if (ids.length !== t.quantidade) {
        throw new AppError('Escolha os aparelhos que serão transferidos.', 400);
      }
      const movidos = await tx.deviceUnit.updateMany({
        where: { id: { in: ids }, unitId: origem.id, status: 'EM_ESTOQUE' },
        data: { unitId: destino.id },
      });
      if (movidos.count !== ids.length) {
        throw new AppError('Um dos aparelhos não está mais na unidade de origem.', 409);
      }
    }

    const comum = {
      produtoId: produto.id,
      produtoNome: produto.name,
      tipo: 'TRANSFERENCIA' as MovementType,
      motivo: 'TRANSFERENCIA' as MovementReason,
      quantidade: t.quantidade,
      origemId: origem.id,
      destinoId: destino.id,
      transferenciaId: transferencia.id,
      usuarioId: t.usuarioId,
      usuarioNome: t.usuarioNome,
      tx,
    };

    // Para UNITARIO os aparelhos já foram movidos acima; aqui só
    // recalculamos o saldo e gravamos a movimentação (sem deviceIds, para
    // não tentar mexer no status de novo).
    const saida = await registrarMovimentoTransferencia(tx, {
      ...comum,
      unidadeId: origem.id,
      sentido: 'sai',
      unitario: produto.tipoControle === 'UNITARIO',
      observacao: `Transferência para ${destino.name}${t.observacao ? ` — ${t.observacao}` : ''}`,
    });

    const entrada = await registrarMovimentoTransferencia(tx, {
      ...comum,
      unidadeId: destino.id,
      sentido: 'entra',
      unitario: produto.tipoControle === 'UNITARIO',
      observacao: `Transferência da ${origem.name}${t.observacao ? ` — ${t.observacao}` : ''}`,
    });

    return { transferencia, origem, destino, produto, saida, entrada };
  });
}

/** Uma perna da transferência: para UNITARIO só recalcula, para QUANTIDADE usa `movimentar`. */
async function registrarMovimentoTransferencia(
  tx: Prisma.TransactionClient,
  m: Omit<Movimento, 'deviceIds'> & { unitario: boolean },
): Promise<{ antes: number; depois: number; id: string }> {
  if (!m.unitario) {
    return movimentar({ ...m, tx });
  }

  const antes = await saldo(m.produtoId, m.unidadeId, tx);
  const depois = await sincronizarSaldoUnitario(m.produtoId, m.unidadeId, tx);

  const registro = await tx.stockMovement.create({
    data: {
      type: m.tipo,
      reason: m.motivo,
      quantity: m.quantidade,
      previousQuantity: antes,
      newQuantity: depois,
      notes: m.observacao ?? null,
      productId: m.produtoId,
      productName: m.produtoNome,
      unitId: m.unidadeId,
      originUnitId: m.origemId ?? null,
      destinationUnitId: m.destinoId ?? null,
      referenceId: m.transferenciaId ?? null,
      transferId: m.transferenciaId ?? null,
      userId: m.usuarioId ?? null,
    },
  });

  return { antes, depois, id: registro.id };
}

/** Cancela uma transferência devolvendo o estoque — sem apagar nada. */
export async function cancelarTransferencia(
  transferenciaId: string,
  usuario?: { id: string; nome: string },
) {
  return db.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({
      where: { id: transferenciaId },
      include: { product: true, originUnit: true, destinationUnit: true },
    });

    if (!t) throw new AppError('Transferência não encontrada', 404);
    if (t.status === 'CANCELADA') throw new AppError('Esta transferência já foi cancelada.');

    if (t.product.tipoControle === 'UNITARIO') {
      // Aparelhos que ainda estão no destino voltam para a origem.
      const noDestino = await tx.deviceUnit.findMany({
        where: {
          productId: t.productId,
          unitId: t.destinationUnitId,
          status: 'EM_ESTOQUE',
        },
        take: t.quantity,
        select: { id: true },
      });
      if (noDestino.length < t.quantity) {
        throw new AppError('Parte dos aparelhos já saiu do destino. Cancelamento bloqueado.', 409);
      }
      await tx.deviceUnit.updateMany({
        where: { id: { in: noDestino.map((d) => d.id) } },
        data: { unitId: t.originUnitId },
      });
      await sincronizarSaldoUnitario(t.productId, t.destinationUnitId, tx);
      await sincronizarSaldoUnitario(t.productId, t.originUnitId, tx);

      await tx.stockMovement.createMany({
        data: [
          {
            type: 'SAIDA', reason: 'CANCELAMENTO', quantity: t.quantity,
            productId: t.productId, productName: t.product.name, unitId: t.destinationUnitId,
            transferId: t.id, userId: usuario?.id ?? null,
            notes: `Cancelamento da transferência para ${t.destinationUnit.name}`,
          },
          {
            type: 'ENTRADA', reason: 'CANCELAMENTO', quantity: t.quantity,
            productId: t.productId, productName: t.product.name, unitId: t.originUnitId,
            transferId: t.id, userId: usuario?.id ?? null,
            notes: `Devolução por cancelamento — voltou para ${t.originUnit.name}`,
          },
        ],
      });
    } else {
      const comum = {
        produtoId: t.productId,
        produtoNome: t.product.name,
        quantidade: t.quantity,
        motivo: 'CANCELAMENTO' as MovementReason,
        transferenciaId: t.id,
        usuarioId: usuario?.id,
        usuarioNome: usuario?.nome,
        tx,
      };

      await movimentar({
        ...comum,
        unidadeId: t.destinationUnitId,
        tipo: 'SAIDA',
        observacao: `Cancelamento da transferência para ${t.destinationUnit.name}`,
      });

      await movimentar({
        ...comum,
        unidadeId: t.originUnitId,
        tipo: 'ENTRADA',
        observacao: `Devolução por cancelamento — voltou para ${t.originUnit.name}`,
      });
    }

    return tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: 'CANCELADA' },
    });
  });
}

// ------------------------------------------------------------------ Alertas

/** Produtos no nível mínimo ou abaixo dele, por unidade. */
export async function estoqueBaixo(unidadeId?: string, limite = 50) {
  const linhas = await db.$queryRaw<
    { productId: string; unitId: string; quantity: number; minQuantity: number }[]
  >`
    SELECT s."productId", s."unitId", s."quantity", p."minQuantity"
    FROM "stock" s
    JOIN "products" p ON p."id" = s."productId"
    WHERE s."quantity" > 0
      AND s."quantity" <= p."minQuantity"
      ${unidadeId ? Prisma.sql`AND s."unitId" = ${unidadeId}` : Prisma.empty}
    ORDER BY s."quantity" ASC
    LIMIT ${limite}
  `;
  return linhas;
}

/** Valor do estoque (a custo e a venda), opcionalmente de uma unidade só. */
export async function valorDoEstoque(unidadeId?: string): Promise<{ custo: number; venda: number }> {
  const [linha] = await db.$queryRaw<{ custo: string | null; venda: string | null }[]>`
    SELECT
      SUM(s."quantity" * p."costPrice")::text AS custo,
      SUM(s."quantity" * COALESCE(NULLIF(p."salePrice", 0), p."wholesalePrice", 0))::text AS venda
    FROM "stock" s
    JOIN "products" p ON p."id" = s."productId"
    WHERE s."quantity" > 0
      ${unidadeId ? Prisma.sql`AND s."unitId" = ${unidadeId}` : Prisma.empty}
  `;
  return { custo: Number(linha?.custo ?? 0), venda: Number(linha?.venda ?? 0) };
}

/** Total de itens em estoque, opcionalmente de uma unidade. */
export async function totalEmEstoque(unidadeId?: string): Promise<number> {
  const soma = await db.stock.aggregate({
    where: unidadeId ? { unitId: unidadeId } : undefined,
    _sum: { quantity: true },
  });
  return soma._sum.quantity ?? 0;
}
