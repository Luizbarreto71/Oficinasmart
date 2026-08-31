import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth';
import {
  AppError,
  contem,
  intervalo,
  limpar,
  naoEncontrado,
  numero,
  ordenar,
  paginacao,
  paginado,
  rota,
  semVazios,
  validar,
} from './core';
import { db, registrarLog } from './db';
import { exigirChaveSeAbaixoDoMinimo } from './preco-minimo';
import { enviarRecibo } from './recibo';
import { lojaSalva } from './sistema';
import { comAsFilhas, movimentar, sincronizarSaldoUnitario } from './estoque';
import { exigir } from './permissoes';
import { unidadePermitida } from './unidades';
import { registrarVenda } from './vendas-service';

/** Vendas concluídas: consulta, PDV direto e cancelamento. */

export const rotasVendas = Router();
rotasVendas.use(autenticar);

const PAGAMENTOS = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'EM_ABERTO', 'OUTRO'] as const;

const COM_TUDO = {
  items: { include: { product: { select: { id: true, name: true, model: true, category: true } } } },
  customer: true,
  unit: { select: { id: true, name: true } },
  seller: { select: { id: true, name: true } },
  cashier: { select: { id: true, name: true } },
  preSale: { select: { id: true, code: true } },
  payments: { orderBy: { amount: 'desc' } as const },
} satisfies Prisma.SaleInclude;

const filtrosSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  paymentMethod: z.enum(PAGAMENTOS).optional(),
  sellerId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type FiltrosVenda = z.infer<typeof filtrosSchema>;

export async function filtrarVendas(q: FiltrosVenda, unidadeId?: string): Promise<Prisma.SaleWhereInput> {
  const cond: Prisma.SaleWhereInput[] = [{ status: 'FINALIZADA' }];

  if (q.search) {
    cond.push({
      OR: [
        { code: contem(q.search) },
        { customerName: contem(q.search) },
        { customerPhone: contem(q.search) },
        { customerDocument: contem(q.search) },
        { items: { some: { productName: contem(q.search) } } },
        { items: { some: { imei: contem(q.search) } } },
        { items: { some: { serialNumber: contem(q.search) } } },
        { items: { some: { product: { name: contem(q.search) } } } },
      ],
    });
  }

  if (q.productId) cond.push({ items: { some: { productId: q.productId } } });
  if (q.categoryId) {
    cond.push({ items: { some: { product: { categoryId: { in: await comAsFilhas(q.categoryId) } } } } });
  }
  if (q.paymentMethod) cond.push({ paymentMethod: q.paymentMethod });
  if (q.sellerId) cond.push({ sellerId: q.sellerId });
  if (q.cashierId) cond.push({ cashierId: q.cashierId });
  if (unidadeId) cond.push({ unitId: unidadeId });

  const periodo = intervalo(q.startDate, q.endDate);
  if (periodo) cond.push({ saleDate: periodo });

  return { AND: cond };
}

rotasVendas.get(
  '/',
  rota(async (req, res) => {
    const q = validar(filtrosSchema, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const p = paginacao(q as Record<string, unknown>);
    const where = await filtrarVendas(q, unidade);

    const [lista, total, somas, itens] = await Promise.all([
      db.sale.findMany({
        where,
        include: COM_TUDO,
        skip: p.skip,
        take: p.take,
        orderBy: ordenar(q.sortBy, q.sortOrder, ['saleDate', 'totalAmount', 'code', 'createdAt'], {
          saleDate: 'desc',
        }) as never,
      }),
      db.sale.count({ where }),
      db.sale.aggregate({ where, _sum: { totalAmount: true, costAmount: true } }),
      db.saleItem.aggregate({ where: { sale: where }, _sum: { quantity: true } }),
    ]);

    res.json(
      limpar({
        ...paginado(lista, total, p),
        totals: {
          revenue: somas._sum.totalAmount ?? 0,
          profit: numero(somas._sum.totalAmount) - numero(somas._sum.costAmount),
          items: itens._sum.quantity ?? 0,
        },
      }),
    );
  }),
);

rotasVendas.get(
  '/:id',
  rota(async (req, res) => {
    const venda = await db.sale.findUnique({ where: { id: req.params.id }, include: COM_TUDO });
    if (!venda) throw naoEncontrado('Venda');
    res.json(limpar(venda));
  }),
);

// ------------------------------------------------------------- PDV direto

const itemSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  quantity: z.coerce.number().int().min(1, 'Quantidade mínima: 1'),
  unitPrice: z.coerce.number().min(0, 'Informe o valor'),
  imei: z.string().trim().max(40).optional().nullable(),
  serialNumber: z.string().trim().max(60).optional().nullable(),
  deviceId: z.string().uuid().optional().nullable(),
});

const vendaSchema = z.object({
  items: z.array(itemSchema).min(1, 'Inclua ao menos um produto'),
  unitId: z.string().uuid('Informe de qual unidade o produto saiu'),
  paymentMethod: z.enum(PAGAMENTOS),
  installments: z.coerce.number().int().min(1).max(24).default(1),
  payments: z
    .array(
      z.object({
        method: z.enum(PAGAMENTOS),
        amount: z.coerce.number().min(0.01, 'Informe o valor desta forma'),
        installments: z.coerce.number().int().min(1).max(24).default(1),
        notes: z.string().trim().max(120).optional().nullable(),
        feePercent: z.coerce.number().min(0).max(99.99).optional().nullable(),
        bandeira: z.enum(['padrao', 'elo']).optional().nullable(),
        autorizacao: z.string().trim().max(30).optional().nullable(),
        destino: z.string().trim().max(60).optional().nullable(),
      }),
    )
    .max(6, 'No máximo 6 formas na mesma venda')
    .optional(),
  customerName: z.string().trim().max(180).optional().nullable(),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  acrescimo: z.coerce.number().min(0).max(999_999).optional().nullable(),
  chaveDeAcesso: z.string().trim().max(60).optional().nullable(),
  tradeIn: z
    .object({
      modelo: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120),
      cor: z.string().trim().max(40).optional().nullable(),
      armazenamento: z.string().trim().max(20).optional().nullable(),
      valorAvaliado: z.coerce.number().min(0.01, 'Informe quanto vale o aparelho do cliente'),
    })
    .array()
    .max(6)
    .or(
      z
        .object({
          modelo: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120),
          cor: z.string().trim().max(40).optional().nullable(),
          armazenamento: z.string().trim().max(20).optional().nullable(),
          valorAvaliado: z.coerce.number().min(0.01, 'Informe quanto vale o aparelho do cliente'),
        })
        .transform((t) => [t]),
    )
    .optional()
    .nullable(),
  sellerId: z.string().uuid().optional().nullable(),
  sellerName: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  saleDate: z.coerce.date().optional(),
});

rotasVendas.post(
  '/',
  exigir('pdv'),
  rota(async (req, res) => {
    const dados = validar(vendaSchema, req.body);
    await exigirChaveSeAbaixoDoMinimo(dados.items, dados.chaveDeAcesso);

    let vendedorId: string | null = dados.sellerId ?? req.usuario!.id;

    if (dados.sellerName?.trim()) {
      const encontrado = await db.user.findFirst({
        where: { name: { equals: dados.sellerName.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      vendedorId = encontrado?.id ?? null;
    }

    const venda = await registrarVenda({
      itens: dados.items,
      unitId: dados.unitId,
      paymentMethod: dados.paymentMethod as never,
      installments: dados.installments,
      pagamentos: dados.payments,
      acrescimo: dados.acrescimo,
      trocaNova: dados.tradeIn,
      customerName: dados.customerName,
      sellerName: dados.sellerName,
      customerPhone: dados.customerPhone,
      customerDocument: dados.customerDocument,
      customerId: dados.customerId,
      notes: dados.notes,
      sellerId: vendedorId,
      cashierId: req.usuario!.id,
      cashierName: req.usuario!.nome,
      saleDate: dados.saleDate,
    });

    await registrarLog({
      acao: 'CRIAR_VENDA',
      entidade: 'Sale',
      id: venda.id,
      alteracoes: {
        venda: venda.code,
        unidade: venda.unit.name,
        pagamento: dados.paymentMethod,
        total: numero(venda.totalAmount),
      },
      req,
    });

    res.status(201).json(limpar(venda));
  }),
);

/** Cancela a venda e devolve tudo ao estoque. */
rotasVendas.delete(
  '/:id',
  exigir('venda.cancelar'),
  rota(async (req, res) => {
    const motivo = String(req.query.reason ?? '').trim();

    const venda = await db.sale.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: { select: { tipoControle: true } }, device: { select: { id: true } } } },
        unit: { select: { name: true } },
      },
    });
    if (!venda) throw naoEncontrado('Venda');
    if (venda.status === 'CANCELADA') throw new AppError('Esta venda já foi cancelada.');

    await db.$transaction(async (tx) => {
      for (const item of venda.items) {
        if (item.product.tipoControle === 'UNITARIO' && item.device) {
          await tx.deviceUnit.update({
            where: { id: item.device.id },
            data: { status: 'EM_ESTOQUE', saleItemId: null, unitId: venda.unitId },
          });
          const depois = await sincronizarSaldoUnitario(item.productId, venda.unitId, tx);
          await tx.stockMovement.create({
            data: {
              type: 'ENTRADA', reason: 'CANCELAMENTO', quantity: item.quantity,
              previousQuantity: Math.max(0, depois - item.quantity), newQuantity: depois,
              deviceId: item.device.id, productId: item.productId, productName: item.productName ?? 'Produto',
              unitId: venda.unitId, saleId: venda.id, userId: req.usuario?.id ?? null,
              notes: `Cancelamento da venda ${venda.code}${motivo ? ` · ${motivo}` : ''}`,
            },
          });
        } else {
          await movimentar({
            produtoId: item.productId,
            produtoNome: item.productName ?? 'Produto',
            unidadeId: venda.unitId,
            tipo: 'ENTRADA',
            motivo: 'CANCELAMENTO',
            quantidade: item.quantity,
            observacao: `Cancelamento da venda ${venda.code}${motivo ? ` · ${motivo}` : ''}`,
            vendaId: venda.id,
            usuarioId: req.usuario?.id,
            usuarioNome: req.usuario?.nome,
            tx,
          });
        }
      }

      await tx.sale.update({ where: { id: venda.id }, data: { status: 'CANCELADA' } });

      await tx.product.updateMany({
        where: {
          id: { in: venda.items.map((i) => i.productId) },
          seminovo: true,
          status: 'VENDIDO',
        },
        data: { status: 'EM_ESTOQUE' },
      });
    });

    await registrarLog({
      acao: 'CANCELAR_VENDA',
      entidade: 'Sale',
      id: venda.id,
      alteracoes: { venda: venda.code, motivo },
      req,
    });

    res.json({
      message: `Venda ${venda.code} cancelada. ${venda.items.reduce((s, i) => s + i.quantity, 0)} peça(s) devolvida(s) ao estoque da ${venda.unit.name}.`,
    });
  }),
);

/** Comprovante da venda, pronto para imprimir. */
rotasVendas.get(
  '/:id/recibo',
  rota(async (req, res) => {
    const venda = await db.sale.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        payments: { orderBy: { amount: 'desc' } },
        unit: { select: { name: true } },
        seller: { select: { name: true } },
        cashier: { select: { name: true } },
        tradeIn: { select: { modelo: true, imei: true, cor: true, armazenamento: true, valorAvaliado: true } },
      },
    });
    if (!venda) throw naoEncontrado('Venda');

    enviarRecibo(res, {
      loja: await lojaSalva(),
      code: venda.code,
      saleDate: venda.saleDate,
      unitName: venda.unit?.name,
      customerName: venda.customerName,
      customerPhone: venda.customerPhone,
      customerDocument: venda.customerDocument,
      sellerName: venda.seller?.name ?? venda.sellerName,
      cashierName: venda.cashier?.name,
      notes: venda.notes,
      items: venda.items.map((i) => ({
        productName: i.productName ?? 'Produto',
        quantity: i.quantity,
        unitPrice: numero(i.unitPrice),
        imei: i.imei,
        serialNumber: i.serialNumber,
      })),
      payments: venda.payments.map((p) => ({
        method: p.method,
        amount: numero(p.amount),
        installments: p.installments,
      })),
      troca: venda.tradeIn
        ? {
            modelo: [venda.tradeIn.modelo, venda.tradeIn.armazenamento, venda.tradeIn.cor]
              .filter(Boolean)
              .join(' · '),
            imei: venda.tradeIn.imei,
            valor: numero(venda.tradeIn.valorAvaliado),
          }
        : null,
      total: numero(venda.totalAmount),
    });
  }),
);

// -------------------------------------------------------------- Edição

const edicaoSchema = z.object({
  customerName: z.string().trim().max(180).optional().nullable(),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),
  sellerName: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  saleDate: z.coerce.date().optional(),
  paymentMethod: z.enum(PAGAMENTOS).optional(),
  installments: z.coerce.number().int().min(1).max(24).optional(),
  payments: z
    .array(
      z.object({
        method: z.enum([...PAGAMENTOS, 'TROCA'] as const),
        amount: z.coerce.number().min(0.01),
        installments: z.coerce.number().int().min(1).max(24).default(1),
      }),
    )
    .max(6)
    .optional(),
});

/**
 * Corrige os dados de uma venda já registrada (cliente, vendedor, forma de
 * pagamento). Para trocar itens, cancele e refaça — assim o rastro dos
 * aparelhos não fica ambíguo.
 */
rotasVendas.put(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const dados = validar(edicaoSchema, req.body);

    const venda = await db.sale.findUnique({
      where: { id: req.params.id },
      include: { payments: true, tradeIn: true },
    });
    if (!venda) throw naoEncontrado('Venda');
    if (venda.status === 'CANCELADA') {
      throw new AppError('Esta venda está cancelada. Registre uma nova em vez de editá-la.');
    }

    let vendedorId = venda.sellerId;
    if (dados.sellerName !== undefined) {
      const nome = dados.sellerName?.trim();
      vendedorId = nome
        ? ((await db.user.findFirst({
            where: { name: { equals: nome, mode: 'insensitive' } },
            select: { id: true },
          }))?.id ?? null)
        : null;
    }

    const total = numero(venda.totalAmount);
    const daTroca = venda.tradeIn ? numero(venda.tradeIn.valorAvaliado) : 0;

    let rateio = dados.payments?.map((p) => ({
      method: p.method,
      amount: new Prisma.Decimal(p.amount),
      installments: p.installments,
    }));

    if (rateio) {
      const soma = rateio.reduce((s, p) => s + numero(p.amount), 0);
      if (Math.abs(soma - total) >= 0.01) {
        throw new AppError(
          `As formas de pagamento somam R$ ${soma.toFixed(2)}, mas a venda é de R$ ${total.toFixed(2)}.`,
        );
      }
      if (daTroca > 0 && !rateio.some((p) => p.method === 'TROCA')) {
        rateio.push({ method: 'TROCA', amount: new Prisma.Decimal(daTroca), installments: 1 });
      }
      await db.salePayment.deleteMany({ where: { saleId: venda.id, method: { not: 'TROCA' } } });
      await db.salePayment.createMany({
        data: rateio.filter((p) => p.method !== 'TROCA').map((p) => ({ ...p, saleId: venda.id })),
      });
    }

    const principal = (rateio ?? venda.payments)
      .filter((p) => p.method !== 'TROCA')
      .reduce<{ method: string; amount: Prisma.Decimal } | null>(
        (m, p) => (!m || p.amount.greaterThan(m.amount) ? p : m),
        null,
      )?.method;

    const atualizada = await db.sale.update({
      where: { id: venda.id },
      data: {
        ...(dados.customerName !== undefined ? { customerName: dados.customerName?.trim() || null } : {}),
        ...(dados.customerPhone !== undefined ? { customerPhone: dados.customerPhone?.trim() || null } : {}),
        ...(dados.customerDocument !== undefined
          ? { customerDocument: dados.customerDocument?.trim() || null }
          : {}),
        ...(dados.sellerName !== undefined
          ? { sellerName: dados.sellerName?.trim() || null, sellerId: vendedorId }
          : {}),
        ...(dados.notes !== undefined ? { notes: dados.notes?.trim() || null } : {}),
        ...(dados.saleDate ? { saleDate: dados.saleDate } : {}),
        ...(dados.installments ? { installments: dados.installments } : {}),
        ...(dados.paymentMethod ? { paymentMethod: dados.paymentMethod } : {}),
        ...(principal && !dados.paymentMethod ? { paymentMethod: principal as never } : {}),
      },
      include: { items: true, payments: true },
    });

    await registrarLog({
      acao: 'EDITAR_VENDA',
      entidade: 'Sale',
      id: venda.id,
      alteracoes: { venda: venda.code },
      req,
    });

    res.json(limpar({ ...atualizada, message: `Venda ${venda.code} atualizada.` }));
  }),
);
