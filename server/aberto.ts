import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth';
import {
  AppError,
  contem,
  limpar,
  naoEncontrado,
  numero,
  paginacao,
  paginado,
  rota,
  semVazios,
  validar,
} from './core';
import { db, registrarLog } from './db';
import { exigir } from './permissoes';
import { unidadePermitida } from './unidades';

/**
 * O que a loja tem a receber. Quando o caixa fecha uma venda com "valor em
 * aberto", o cliente levou a mercadoria e ficou devendo.
 */
export const rotasEmAberto = Router();
rotasEmAberto.use(autenticar);

const COM_A_VENDA = {
  sale: {
    select: {
      id: true,
      code: true,
      saleDate: true,
      customerName: true,
      customerPhone: true,
      customerDocument: true,
      unit: { select: { id: true, name: true } },
      seller: { select: { name: true } },
      sellerName: true,
      items: { select: { productName: true, quantity: true } },
    },
  },
} satisfies Prisma.SalePaymentInclude;

const diasDesde = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

rotasEmAberto.get(
  '/',
  exigir('prevenda.verTodas'),
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
        search: z.string().trim().optional(),
        unitId: z.string().uuid().optional(),
        situacao: z.enum(['abertos', 'quitados', 'todos']).default('abertos'),
      }),
      semVazios(req.query),
    );

    const p = paginacao(q as Record<string, unknown>);
    const unidade = unidadePermitida(req.usuario, q.unitId);

    const where: Prisma.SalePaymentWhereInput = {
      method: 'EM_ABERTO',
      ...(q.situacao === 'abertos' ? { settledAt: null } : {}),
      ...(q.situacao === 'quitados' ? { NOT: { settledAt: null } } : {}),
      sale: {
        status: 'FINALIZADA',
        ...(unidade ? { unitId: unidade } : {}),
        ...(q.search
          ? {
              OR: [
                { customerName: contem(q.search) },
                { customerPhone: contem(q.search) },
                { code: contem(q.search) },
              ],
            }
          : {}),
      },
    };

    const [lista, total, emAberto] = await Promise.all([
      db.salePayment.findMany({
        where,
        include: COM_A_VENDA,
        skip: p.skip,
        take: p.take,
        orderBy: { sale: { saleDate: 'asc' } },
      }),
      db.salePayment.count({ where }),
      db.salePayment.aggregate({
        where: { method: 'EM_ABERTO', settledAt: null, sale: { status: 'FINALIZADA' } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.json(
      limpar({
        ...paginado(
          lista.map((pag) => ({
            ...pag,
            dias: diasDesde(pag.sale.saleDate),
            vendedor: pag.sale.seller?.name ?? pag.sale.sellerName ?? null,
            produtos: pag.sale.items.map((i) => `${i.quantity}× ${i.productName}`).join(', '),
          })),
          total,
          p,
        ),
        resumo: {
          cobrancas: emAberto._count,
          total: numero(emAberto._sum.amount),
        },
      }),
    );
  }),
);

const baixaSchema = z.object({
  method: z.enum(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'OUTRO']),
});

rotasEmAberto.post(
  '/:id/receber',
  exigir('venda.finalizar'),
  rota(async (req, res) => {
    const { method } = validar(baixaSchema, req.body);

    const cobranca = await db.salePayment.findUnique({
      where: { id: req.params.id },
      include: { sale: { select: { code: true, customerName: true } } },
    });

    if (!cobranca || cobranca.method !== 'EM_ABERTO') throw naoEncontrado('Cobrança');
    if (cobranca.settledAt) throw new AppError('Esta cobrança já foi quitada.');

    await db.salePayment.update({
      where: { id: cobranca.id },
      data: {
        settledAt: new Date(),
        settledMethod: method,
        settledById: req.usuario?.id ?? null,
        netAmount: cobranca.amount,
      },
    });

    await registrarLog({
      acao: 'RECEBER_EM_ABERTO',
      entidade: 'SalePayment',
      id: cobranca.id,
      alteracoes: { venda: cobranca.sale.code, valor: numero(cobranca.amount), forma: method },
      req,
    });

    res.json({
      message:
        `Recebido de ${cobranca.sale.customerName ?? 'cliente'}: ` +
        `R$ ${numero(cobranca.amount).toFixed(2)} da venda ${cobranca.sale.code}.`,
    });
  }),
);

rotasEmAberto.post(
  '/:id/reabrir',
  exigir('venda.finalizar'),
  rota(async (req, res) => {
    const cobranca = await db.salePayment.findUnique({ where: { id: req.params.id } });
    if (!cobranca || cobranca.method !== 'EM_ABERTO') throw naoEncontrado('Cobrança');
    if (!cobranca.settledAt) throw new AppError('Esta cobrança já está em aberto.');

    await db.salePayment.update({
      where: { id: cobranca.id },
      data: {
        settledAt: null,
        settledMethod: null,
        settledById: null,
        netAmount: new Prisma.Decimal(0),
      },
    });

    await registrarLog({ acao: 'REABRIR_EM_ABERTO', entidade: 'SalePayment', id: cobranca.id, req });
    res.json({ message: 'Cobrança reaberta.' });
  }),
);
