import { Prisma } from '@prisma/client';
import { seminovosDaTroca } from './seminovos';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth';
import {
  AppError,
  intervalo,
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
import { disponivel } from './estoque';
import { notificar, notificarPerfil } from './notificacoes';
import { exigirChaveSeAbaixoDoMinimo } from './preco-minimo';
import { exigir, podeFazer } from './permissoes';
import { proximoCodigo, registrarVenda } from './vendas-service';

/**
 * Pré-venda: a intenção de venda montada pelo vendedor.
 *
 * Criar uma pré-venda NÃO mexe no estoque. A baixa só acontece quando o
 * caixa confirma que o cliente pagou.
 */

export const rotasPreVendas = Router();
rotasPreVendas.use(autenticar);

const PAGAMENTOS = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'EM_ABERTO', 'OUTRO'] as const;

const STATUS_PRE_VENDA = [
  'AGUARDANDO_CAIXA',
  'EM_ATENDIMENTO',
  'FINALIZADA',
  'CANCELADA',
  'EXPIRADA',
] as const;

const COM_TUDO = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          model: true,
          imei: true,
          brand: true,
          capacity: true,
          color: true,
          condicao: true,
          tipoControle: true,
          photos: { select: { id: true }, take: 1, orderBy: { createdAt: 'asc' } as const },
        },
      },
    },
  },
  seller: { select: { id: true, name: true } },
  tradeIn: {
    select: {
      id: true,
      code: true,
      modelo: true,
      imei: true,
      imeiSituacao: true,
      valorAvaliado: true,
      estado: true,
      defeitos: true,
    },
  },
  cashier: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  sale: { select: { id: true, code: true } },
} satisfies Prisma.PreSaleInclude;

const itemSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  quantity: z.coerce.number().int().min(1, 'Quantidade mínima: 1'),
  unitPrice: z.coerce.number().min(0, 'Informe o valor'),
  imei: z.string().trim().max(40).optional().nullable(),
  serialNumber: z.string().trim().max(60).optional().nullable(),
  deviceId: z.string().uuid().optional().nullable(),
});

const preVendaSchema = z.object({
  customerName: z.string().trim().min(2, 'Informe o nome do cliente').max(180),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(PAGAMENTOS).optional().nullable(),
  installments: z.coerce.number().int().min(1).max(24).default(1),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Inclua ao menos um produto'),
  tradeInId: z.string().uuid().optional().nullable(),
  chaveDeAcesso: z.string().trim().max(60).optional().nullable(),
});

const podeVerTodas = (req: { usuario?: { papel: string; id: string } }) =>
  podeFazer(req.usuario?.papel, 'prevenda.verTodas');

async function liberarTroca(preSaleId: string) {
  await db.tradeIn.updateMany({
    where: { preSaleId, status: 'AVALIADA' },
    data: { preSaleId: null },
  });
}

// --------------------------------------------------------------- Listagem

rotasPreVendas.get(
  '/',
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        status: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
          .pipe(z.array(z.enum(STATUS_PRE_VENDA)).min(1).optional()),
        sellerId: z.string().uuid().optional(),
        search: z.string().trim().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
      semVazios(req.query),
    );

    const p = paginacao(q as Record<string, unknown>);
    const periodo = intervalo(q.startDate, q.endDate);

    const where: Prisma.PreSaleWhereInput = {
      ...(podeVerTodas(req) ? (q.sellerId ? { sellerId: q.sellerId } : {}) : { sellerId: req.usuario!.id }),
      ...(q.status ? { status: { in: q.status } } : {}),
      ...(periodo ? { createdAt: periodo } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
              { customerPhone: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [lista, total, pendentes] = await Promise.all([
      db.preSale.findMany({
        where,
        include: COM_TUDO,
        skip: p.skip,
        take: p.take,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
      db.preSale.count({ where }),
      db.preSale.count({ where: { ...where, status: 'AGUARDANDO_CAIXA' } }),
    ]);

    res.json(limpar({ ...paginado(lista, total, p), pendentes }));
  }),
);

rotasPreVendas.get(
  '/:id',
  rota(async (req, res) => {
    const preVenda = await db.preSale.findUnique({ where: { id: req.params.id }, include: COM_TUDO });
    if (!preVenda) throw naoEncontrado('Pré-venda');

    if (!podeVerTodas(req) && preVenda.sellerId !== req.usuario!.id) {
      throw new AppError('Esta pré-venda é de outro vendedor', 403);
    }

    const itens = await Promise.all(
      preVenda.items.map(async (item) => ({
        ...item,
        disponivel: preVenda.unitId ? await disponivel(item.productId, preVenda.unitId) : null,
      })),
    );

    res.json(limpar({ ...preVenda, items: itens }));
  }),
);

// ----------------------------------------------------------------- Criação

rotasPreVendas.post(
  '/',
  exigir('prevenda.criar'),
  rota(async (req, res) => {
    const dados = validar(preVendaSchema, req.body);
    await exigirChaveSeAbaixoDoMinimo(dados.items, dados.chaveDeAcesso);

    const produtos = await db.product.findMany({
      where: { id: { in: dados.items.map((i) => i.productId) } },
      select: { id: true, name: true },
    });

    if (produtos.length !== new Set(dados.items.map((i) => i.productId)).size) {
      throw naoEncontrado('Produto');
    }

    const bruto = dados.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    let abatimento = 0;
    if (dados.tradeInId) {
      const troca = await db.tradeIn.findUnique({ where: { id: dados.tradeInId } });
      if (!troca) throw naoEncontrado('Troca');
      if (troca.preSaleId || troca.saleId) {
        throw new AppError(`A troca ${troca.code} já está em outra pré-venda.`);
      }
      if (troca.status !== 'AVALIADA') {
        throw new AppError(`A troca ${troca.code} não está mais disponível.`);
      }
      if (troca.imeiSituacao === 'BLOQUEADO') {
        throw new AppError(`A troca ${troca.code} tem IMEI bloqueado na Anatel.`);
      }
      abatimento = Number(troca.valorAvaliado);
    }

    const total = Math.max(0, bruto - abatimento);

    const preVenda = await db.preSale.create({
      data: {
        code: await proximoCodigo('prevenda', 'PV'),
        sellerId: req.usuario!.id,
        customerId: dados.customerId ?? null,
        customerName: dados.customerName,
        customerPhone: dados.customerPhone ?? null,
        customerDocument: dados.customerDocument ?? null,
        unitId: dados.unitId ?? req.usuario!.unidadeId ?? null,
        paymentMethod: dados.paymentMethod ?? null,
        installments: dados.installments,
        notes: dados.notes ?? null,
        totalAmount: new Prisma.Decimal(total),
        ...(dados.tradeInId ? { tradeIn: { connect: { id: dados.tradeInId } } } : {}),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        items: {
          create: dados.items.map((i) => ({
            productId: i.productId,
            productName: produtos.find((p) => p.id === i.productId)?.name,
            quantity: i.quantity,
            unitPrice: new Prisma.Decimal(i.unitPrice),
            imei: i.imei?.trim() || null,
            serialNumber: i.serialNumber?.trim() || null,
            deviceId: i.deviceId ?? null,
          })),
        },
      },
      include: COM_TUDO,
    });

    await notificarPerfil('CAIXA', {
      title: `Nova pré-venda ${preVenda.code}`,
      message:
        `${preVenda.customerName} · ${dados.items.length} item(ns) · R$ ${total.toFixed(2)}` +
        (abatimento ? ` (troca de R$ ${abatimento.toFixed(2)} já abatida)` : '') +
        ` · por ${req.usuario!.nome}`,
      link: '/caixa',
    });

    await registrarLog({
      acao: 'CRIAR_PREVENDA',
      entidade: 'PreSale',
      id: preVenda.id,
      alteracoes: { codigo: preVenda.code, total, itens: dados.items.length, troca: dados.tradeInId ?? null },
      req,
    });

    res.status(201).json(limpar({ ...preVenda, message: `Pré-venda ${preVenda.code} enviada ao caixa.` }));
  }),
);

// -------------------------------------------------------- Fluxo do caixa

rotasPreVendas.post(
  '/:id/atender',
  exigir('venda.finalizar'),
  rota(async (req, res) => {
    const preVenda = await db.preSale.findUnique({ where: { id: req.params.id } });
    if (!preVenda) throw naoEncontrado('Pré-venda');

    if (preVenda.status === 'FINALIZADA') throw new AppError('Esta pré-venda já virou venda.');
    if (preVenda.status === 'CANCELADA') throw new AppError('Esta pré-venda foi cancelada.');

    if (preVenda.status === 'EM_ATENDIMENTO' && preVenda.cashierId !== req.usuario!.id) {
      const outro = await db.user.findUnique({ where: { id: preVenda.cashierId ?? '' } });
      throw new AppError(`${outro?.name ?? 'Outro caixa'} já está atendendo esta pré-venda.`, 409);
    }

    const atualizada = await db.preSale.update({
      where: { id: preVenda.id },
      data: { status: 'EM_ATENDIMENTO', cashierId: req.usuario!.id },
      include: COM_TUDO,
    });

    res.json(limpar(atualizada));
  }),
);

const finalizarSchema = z.object({
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
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(itemSchema.extend({ id: z.string().uuid().optional() })).optional(),
  chaveDeAcesso: z.string().trim().max(60).optional().nullable(),
});

rotasPreVendas.post(
  '/:id/finalizar',
  exigir('venda.finalizar'),
  rota(async (req, res) => {
    const dados = validar(finalizarSchema, req.body);
    if (dados.items) await exigirChaveSeAbaixoDoMinimo(dados.items, dados.chaveDeAcesso);

    const preVenda = await db.preSale.findUnique({
      where: { id: req.params.id },
      include: { items: true, seller: { select: { id: true, name: true } }, tradeIn: true },
    });
    if (!preVenda) throw naoEncontrado('Pré-venda');

    if (preVenda.status === 'FINALIZADA') throw new AppError('Esta pré-venda já virou venda.');
    if (preVenda.status === 'CANCELADA') throw new AppError('Esta pré-venda foi cancelada.');

    if (preVenda.tradeIn?.imeiSituacao === 'BLOQUEADO') {
      throw new AppError(
        `A troca ${preVenda.tradeIn.code} tem IMEI bloqueado na Anatel. Não é possível fechar a venda com esse aparelho.`,
      );
    }

    const itens = (dados.items ?? preVenda.items).map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: numero(i.unitPrice as never),
      imei: i.imei ?? null,
      serialNumber: i.serialNumber ?? null,
      deviceId: i.deviceId ?? null,
    }));

    const venda = await registrarVenda({
      itens,
      unitId: dados.unitId,
      paymentMethod: dados.paymentMethod as never,
      installments: dados.installments,
      pagamentos: dados.payments,
      trocaValor: preVenda.tradeIn ? numero(preVenda.tradeIn.valorAvaliado) : null,
      customerName: preVenda.customerName,
      customerPhone: preVenda.customerPhone,
      customerDocument: preVenda.customerDocument,
      customerId: preVenda.customerId,
      notes: dados.notes ?? preVenda.notes,
      sellerId: preVenda.sellerId,
      cashierId: req.usuario!.id,
      cashierName: req.usuario!.nome,
      preSaleId: preVenda.id,
    });

    await db.preSale.update({
      where: { id: preVenda.id },
      data: { status: 'FINALIZADA', cashierId: req.usuario!.id },
    });

    if (preVenda.tradeIn) {
      await db.tradeIn.update({
        where: { id: preVenda.tradeIn.id },
        data: { status: 'ACEITA', saleId: venda.id },
      });
      await seminovosDaTroca(preVenda.tradeIn.id, dados.unitId, req.usuario!.id);
    }

    await registrarLog({
      acao: 'FINALIZAR_PREVENDA',
      entidade: 'Sale',
      id: venda.id,
      alteracoes: {
        preVenda: preVenda.code,
        venda: venda.code,
        unidade: venda.unit.name,
        pagamento: dados.paymentMethod,
        total: numero(venda.totalAmount),
      },
      req,
    });

    res.json(
      limpar({
        sale: venda,
        message: `Venda ${venda.code} registrada. Estoque atualizado na ${venda.unit.name}.`,
      }),
    );
  }),
);

rotasPreVendas.post(
  '/:id/cancelar',
  exigir('venda.finalizar'),
  rota(async (req, res) => {
    const { motivo } = validar(
      z.object({ motivo: z.string().trim().max(300).optional() }),
      req.body ?? {},
    );

    const preVenda = await db.preSale.findUnique({ where: { id: req.params.id } });
    if (!preVenda) throw naoEncontrado('Pré-venda');
    if (preVenda.status === 'FINALIZADA') throw new AppError('Esta pré-venda já virou venda.');

    await db.preSale.update({
      where: { id: preVenda.id },
      data: {
        status: 'CANCELADA',
        cashierId: req.usuario!.id,
        notes: motivo ? `${preVenda.notes ?? ''}\nCancelada: ${motivo}`.trim() : preVenda.notes,
      },
    });

    await liberarTroca(preVenda.id);

    await notificar({
      userId: preVenda.sellerId,
      title: `Pré-venda ${preVenda.code} cancelada`,
      message: motivo ? `Motivo: ${motivo}` : `Cancelada por ${req.usuario!.nome}`,
      link: '/minhas-prevendas',
    });

    await registrarLog({ acao: 'CANCELAR_PREVENDA', entidade: 'PreSale', id: preVenda.id, req });
    res.json({ message: `Pré-venda ${preVenda.code} cancelada. O estoque não foi alterado.` });
  }),
);

rotasPreVendas.delete(
  '/:id',
  rota(async (req, res) => {
    const preVenda = await db.preSale.findUnique({ where: { id: req.params.id } });
    if (!preVenda) throw naoEncontrado('Pré-venda');

    const dono = preVenda.sellerId === req.usuario!.id;
    if (!dono && !podeVerTodas(req)) throw new AppError('Esta pré-venda é de outro vendedor', 403);

    if (preVenda.status !== 'AGUARDANDO_CAIXA') {
      throw new AppError('O caixa já começou a atender — peça para ele cancelar.');
    }

    await db.preSale.update({ where: { id: preVenda.id }, data: { status: 'CANCELADA' } });
    await liberarTroca(preVenda.id);
    await registrarLog({ acao: 'CANCELAR_PREVENDA', entidade: 'PreSale', id: preVenda.id, req });

    res.json({ message: `Pré-venda ${preVenda.code} cancelada.` });
  }),
);
