import { PaymentMethod, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth';
import {
  AppError,
  dataHoraBR,
  limpar,
  naoEncontrado,
  numero,
  PAGAMENTO_LABEL,
  rota,
  semVazios,
  validar,
} from './core';
import { db, registrarLog } from './db';
import { decimal, exportar, reais } from './exportar';
import { exigir, podeFazer } from './permissoes';
import { proximoCodigo } from './vendas-service';

/**
 * Turno do caixa: abre, recebe as vendas do período e fecha com o resumo
 * por forma de pagamento.
 */

export const rotasCaixa = Router();
rotasCaixa.use(autenticar);

async function resumoDoTurno(where: Prisma.SaleWhereInput) {
  const [vendas, porPagamento, itens] = await Promise.all([
    db.sale.aggregate({ where, _sum: { totalAmount: true, costAmount: true }, _count: true }),
    db.salePayment.groupBy({
      by: ['method', 'destino'],
      where: { sale: where },
      _sum: { amount: true },
      _count: true,
    }),
    db.saleItem.aggregate({ where: { sale: where }, _sum: { quantity: true } }),
  ]);

  const total = numero(vendas._sum.totalAmount);
  const somaDasFormas = porPagamento.reduce((s, p) => s + numero(p._sum.amount), 0);

  return {
    quantidadeDeVendas: vendas._count,
    itensVendidos: itens._sum.quantity ?? 0,
    total,
    lucro: total - numero(vendas._sum.costAmount),
    ticketMedio: vendas._count ? total / vendas._count : 0,
    divergencia: Math.abs(total - somaDasFormas) < 0.01 ? 0 : total - somaDasFormas,
    porPagamento: (Object.keys(PAGAMENTO_LABEL) as PaymentMethod[]).flatMap((forma) => {
      const linhas = porPagamento.filter((p) => p.method === forma);

      if (forma === 'PIX' && linhas.some((l) => l.destino)) {
        return linhas.map((l) => ({
          forma,
          rotulo: l.destino ?? PAGAMENTO_LABEL[forma],
          quantidade: l._count,
          total: numero(l._sum.amount),
        }));
      }

      return [
        {
          forma,
          rotulo: PAGAMENTO_LABEL[forma],
          quantidade: linhas.reduce((s, l) => s + l._count, 0),
          total: linhas.reduce((s, l) => s + numero(l._sum.amount), 0),
        },
      ];
    }),
  };
}

rotasCaixa.get(
  '/atual',
  exigir('pdv'),
  rota(async (req, res) => {
    const turno = await db.cashRegister.findFirst({
      where: { cashierId: req.usuario!.id, status: 'ABERTO' },
      include: { unit: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'desc' },
    });

    if (!turno) {
      res.json({ aberto: false, turno: null, resumo: null });
      return;
    }

    const resumo = await resumoDoTurno({ cashRegisterId: turno.id, status: 'FINALIZADA' });

    res.json(limpar({ aberto: true, turno, resumo }));
  }),
);

rotasCaixa.post(
  '/abrir',
  exigir('pdv'),
  rota(async (req, res) => {
    const { unitId, notes } = validar(
      z.object({
        unitId: z.string().uuid().optional().nullable(),
        notes: z.string().trim().max(300).optional().nullable(),
      }),
      req.body ?? {},
    );

    const aberto = await db.cashRegister.findFirst({
      where: { cashierId: req.usuario!.id, status: 'ABERTO' },
    });
    if (aberto) throw new AppError('Você já tem um caixa aberto. Feche-o antes de abrir outro.');

    const turno = await db.cashRegister.create({
      data: {
        code: await proximoCodigo('caixa', 'CX'),
        cashierId: req.usuario!.id,
        unitId: unitId ?? req.usuario!.unidadeId ?? null,
        notes: notes ?? null,
      },
      include: { unit: { select: { name: true } } },
    });

    await registrarLog({ acao: 'ABRIR_CAIXA', entidade: 'CashRegister', id: turno.id, req });
    res.status(201).json(limpar({ turno, message: `Caixa ${turno.code} aberto.` }));
  }),
);

rotasCaixa.post(
  '/fechar',
  exigir('caixa.fechar'),
  rota(async (req, res) => {
    const { notes } = validar(
      z.object({ notes: z.string().trim().max(500).optional().nullable() }),
      req.body ?? {},
    );

    const turno = await db.cashRegister.findFirst({
      where: { cashierId: req.usuario!.id, status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
    });
    if (!turno) throw new AppError('Você não tem caixa aberto.');

    const resumo = await resumoDoTurno({ cashRegisterId: turno.id, status: 'FINALIZADA' });

    const fechado = await db.cashRegister.update({
      where: { id: turno.id },
      data: {
        status: 'FECHADO',
        closedAt: new Date(),
        notes: notes ?? turno.notes,
        summary: JSON.parse(JSON.stringify(resumo)) as object,
      },
      include: { unit: { select: { name: true } }, cashier: { select: { name: true } } },
    });

    await registrarLog({
      acao: 'FECHAR_CAIXA',
      entidade: 'CashRegister',
      id: turno.id,
      alteracoes: { total: resumo.total, vendas: resumo.quantidadeDeVendas },
      req,
    });

    res.json(
      limpar({
        turno: fechado,
        resumo,
        message: `Caixa ${turno.code} fechado · ${resumo.quantidadeDeVendas} venda(s) · ${reais(resumo.total)}`,
      }),
    );
  }),
);

rotasCaixa.get(
  '/',
  exigir('pdv'),
  rota(async (req, res) => {
    const q = validar(
      z.object({
        cashierId: z.string().uuid().optional(),
        status: z.enum(['ABERTO', 'FECHADO']).optional(),
      }),
      semVazios(req.query),
    );

    const de = podeFazer(req.usuario?.papel, 'caixa.verTodos') ? q.cashierId : req.usuario!.id;

    const turnos = await db.cashRegister.findMany({
      where: { ...(de ? { cashierId: de } : {}), ...(q.status ? { status: q.status } : {}) },
      include: { cashier: { select: { name: true } }, unit: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
      take: 60,
    });

    res.json(limpar(turnos));
  }),
);

rotasCaixa.get(
  '/:id/relatorio',
  exigir('pdv'),
  rota(async (req, res) => {
    const { format } = validar(
      z.object({ format: z.enum(['json', 'pdf', 'xlsx', 'csv']).default('json') }),
      semVazios(req.query),
    );

    const turno = await db.cashRegister.findUnique({
      where: { id: req.params.id },
      include: { cashier: { select: { id: true, name: true } }, unit: { select: { name: true } } },
    });
    if (!turno) throw naoEncontrado('Caixa');

    if (!podeFazer(req.usuario?.papel, 'caixa.verTodos') && turno.cashierId !== req.usuario!.id) {
      throw new AppError('Este fechamento é de outro caixa', 403);
    }

    const where: Prisma.SaleWhereInput = { cashRegisterId: turno.id, status: 'FINALIZADA' };

    const [vendas, resumo] = await Promise.all([
      db.sale.findMany({
        where,
        include: {
          items: true,
          seller: { select: { name: true } },
          unit: { select: { name: true } },
        },
        orderBy: { saleDate: 'asc' },
      }),
      resumoDoTurno(where),
    ]);

    const linhas = vendas.flatMap((v) =>
      v.items.map((i) => ({
        code: v.code,
        data: dataHoraBR(v.saleDate),
        vendedor: v.seller?.name ?? v.sellerName ?? '—',
        cliente: v.customerName ?? '—',
        produto: i.productName ?? '—',
        imei: i.imei ?? '—',
        serie: i.serialNumber ?? '—',
        quantidade: i.quantity,
        valor: numero(i.unitPrice) * i.quantity,
        pagamento: PAGAMENTO_LABEL[v.paymentMethod],
        parcelas: v.installments,
        unidade: v.unit.name,
      })),
    );

    if (format === 'json') {
      res.json(limpar({ turno, resumo, vendas: linhas }));
      return;
    }

    await exportar(res, format, {
      title: `Fechamento de Caixa ${turno.code}`,
      subtitle:
        `Caixa: ${turno.cashier.name} · Aberto em ${dataHoraBR(turno.openedAt)}` +
        (turno.closedAt ? ` · Fechado em ${dataHoraBR(turno.closedAt)}` : ' · EM ABERTO'),
      columns: [
        { header: 'Venda', key: 'code', width: 11 },
        { header: 'Data/hora', key: 'data', width: 15 },
        { header: 'Vendedor', key: 'vendedor', width: 15 },
        { header: 'Cliente', key: 'cliente', width: 18 },
        { header: 'Produto', key: 'produto', width: 24 },
        { header: 'IMEI', key: 'imei', width: 16 },
        { header: 'Nº série', key: 'serie', width: 14 },
        { header: 'Qtd', key: 'quantidade', width: 5, align: 'right' as const },
        { header: 'Valor', key: 'valor', width: 12, align: 'right' as const, format: decimal },
        { header: 'Pagamento', key: 'pagamento', width: 12 },
        { header: 'Parc.', key: 'parcelas', width: 6, align: 'right' as const },
        { header: 'Unidade', key: 'unidade', width: 12 },
      ],
      rows: linhas,
      summary: [
        { label: 'Vendas', value: String(resumo.quantidadeDeVendas) },
        { label: 'Produtos vendidos', value: String(resumo.itensVendidos) },
        ...resumo.porPagamento
          .filter((p) => p.quantidade > 0)
          .map((p) => ({ label: `Total em ${p.rotulo}`, value: reais(p.total) })),
        { label: 'TOTAL GERAL', value: reais(resumo.total) },
        { label: 'Ticket médio', value: reais(resumo.ticketMedio) },
        { label: 'Lucro estimado', value: reais(resumo.lucro) },
      ],
    });
  }),
);
