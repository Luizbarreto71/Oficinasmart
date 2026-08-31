import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth';
import { exigir } from './permissoes';
import {
  AppError,
  contem,
  intervalo,
  limpar,
  naoEncontrado,
  paginacao,
  paginado,
  rota,
  semVazios,
  validar,
} from './core';
import { db, registrarLog } from './db';
import { custoMedio } from '../shared/custo';
import {
  cancelarTransferencia,
  comAsFilhas,
  disponivel,
  movimentar,
  saldoTotal,
  transferir,
} from './estoque';
import { exigirAcessoNaUnidade, unidadePermitida } from './unidades';

/** Entrada, saída, transferência e o histórico de tudo isso (produtos por quantidade). */

export const rotasMovimentacoes = Router();
rotasMovimentacoes.use(autenticar, exigir('estoque.ver'));

const MOTIVOS = [
  'COMPRA',
  'VENDA',
  'DEFEITO',
  'DEVOLUCAO_FORNECEDOR',
  'PERDA',
  'USO_INTERNO',
  'AJUSTE',
  'OUTRO',
] as const;

async function exigirQuantidade(productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { tipoControle: true, name: true } });
  if (!p) throw naoEncontrado('Produto');
  if (p.tipoControle === 'UNITARIO') {
    throw new AppError(
      `"${p.name}" é controlado por aparelho. Use "Aparelhos" para dar entrada, baixa ou correção.`,
    );
  }
}

// ------------------------------------------------------------------ Entrada

const entradaSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  unitId: z.string().uuid('Selecione a unidade'),
  quantity: z.coerce.number().int().min(1, 'A quantidade deve ser no mínimo 1'),
  supplierId: z.string().uuid().optional().nullable(),
  costPrice: z.coerce.number().min(0).optional(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  reason: z.enum(MOTIVOS).default('COMPRA'),
});

rotasMovimentacoes.post(
  '/entrada',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(entradaSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.unitId);
    await exigirQuantidade(dados.productId);

    const produto = await db.product.findUnique({ where: { id: dados.productId } });
    if (!produto) throw naoEncontrado('Produto');

    const saldoAntes = await saldoTotal(produto.id);
    const medioAntes = Number(produto.costPrice);

    const medioDepois =
      dados.costPrice !== undefined
        ? custoMedio(saldoAntes, medioAntes, dados.quantity, dados.costPrice)
        : medioAntes;

    if (dados.costPrice !== undefined || dados.supplierId) {
      await db.product.update({
        where: { id: produto.id },
        data: {
          ...(dados.costPrice !== undefined
            ? {
                costPrice: medioDepois,
                lastPurchaseCost: dados.costPrice,
                lastPurchaseAt: dados.date ?? new Date(),
              }
            : {}),
          ...(dados.supplierId ? { supplierId: dados.supplierId } : {}),
        },
      });
    }

    const resultado = await movimentar({
      produtoId: produto.id,
      produtoNome: produto.name,
      unidadeId: dados.unitId,
      tipo: 'ENTRADA',
      motivo: dados.reason,
      quantidade: dados.quantity,
      custoUnitario: dados.costPrice,
      observacao: dados.notes,
      usuarioId: req.usuario?.id,
      usuarioNome: req.usuario?.nome,
    });

    if (dados.costPrice !== undefined) {
      await db.stockMovement.update({
        where: { id: resultado.id },
        data: { averageCostAfter: medioDepois },
      });
    }

    await registrarLog({
      acao: 'ENTRADA',
      entidade: 'Stock',
      id: produto.id,
      alteracoes:
        dados.costPrice !== undefined
          ? { quantidade: dados.quantity, nota: dados.costPrice, medioAntes, medioDepois }
          : { quantidade: dados.quantity },
      req,
    });

    res.status(201).json({
      ...resultado,
      custoMedio: medioDepois,
      custoMedioAnterior: medioAntes,
      ultimaCompra: dados.costPrice ?? null,
      message:
        `Entrada de ${dados.quantity} un. registrada.` +
        (dados.costPrice !== undefined && medioDepois !== medioAntes
          ? ` Custo médio: R$ ${medioAntes.toFixed(2)} → R$ ${medioDepois.toFixed(2)}.`
          : ''),
    });
  }),
);

// -------------------------------------------------------------------- Saída

const saidaSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  unitId: z.string().uuid('Selecione a unidade'),
  quantity: z.coerce.number().int().min(1, 'A quantidade deve ser no mínimo 1'),
  reason: z.enum(MOTIVOS, { errorMap: () => ({ message: 'Selecione o motivo' }) }),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

rotasMovimentacoes.post(
  '/saida',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(saidaSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.unitId);
    await exigirQuantidade(dados.productId);

    const produto = await db.product.findUnique({ where: { id: dados.productId } });
    if (!produto) throw naoEncontrado('Produto');

    const resultado = await movimentar({
      produtoId: produto.id,
      produtoNome: produto.name,
      unidadeId: dados.unitId,
      tipo: 'SAIDA',
      motivo: dados.reason,
      quantidade: dados.quantity,
      observacao: dados.notes,
      usuarioId: req.usuario?.id,
      usuarioNome: req.usuario?.nome,
    });

    await registrarLog({ acao: 'SAIDA', entidade: 'Stock', id: produto.id, req });
    res.status(201).json({ ...resultado, message: `Saída de ${dados.quantity} un. registrada.` });
  }),
);

// ------------------------------------------------------------- Transferência

const transferenciaSchema = z.object({
  itens: z
    .array(
      z.object({
        productId: z.string().uuid('Selecione o produto'),
        quantity: z.coerce.number().int().min(1, 'A quantidade deve ser no mínimo 1'),
        /** Aparelhos escolhidos, se o produto for controlado por unidade. */
        deviceIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
  productId: z.string().uuid('Selecione o produto').optional(),
  quantity: z.coerce.number().int().min(1, 'A quantidade deve ser no mínimo 1').optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
  originUnitId: z.string().uuid('Selecione a unidade de origem'),
  destinationUnitId: z.string().uuid('Selecione a unidade de destino'),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

rotasMovimentacoes.post(
  '/transferencia',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(transferenciaSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.originUnitId);

    const itens = dados.itens?.length
      ? dados.itens
      : dados.productId
        ? [{ productId: dados.productId, quantity: dados.quantity ?? 1, deviceIds: dados.deviceIds }]
        : [];

    if (!itens.length) throw new AppError('Escolha ao menos um produto para transferir.');

    const ids = itens.map((i) => i.productId);
    const repetido = ids.find((id, i) => ids.indexOf(id) !== i);
    if (repetido) throw new AppError('O mesmo produto foi escolhido duas vezes. Junte na mesma linha.');

    const feitas: Awaited<ReturnType<typeof transferir>>[] = [];
    for (const item of itens) {
      feitas.push(
        await transferir({
          produtoId: item.productId,
          origemId: dados.originUnitId,
          destinoId: dados.destinationUnitId,
          quantidade: item.quantity,
          deviceIds: item.deviceIds,
          observacao: dados.notes,
          usuarioId: req.usuario?.id,
          usuarioNome: req.usuario?.nome,
        }),
      );
    }

    for (const r of feitas) {
      await registrarLog({ acao: 'TRANSFERENCIA', entidade: 'StockTransfer', id: r.transferencia.id, req });
    }

    const primeira = feitas[0];
    const pecas = itens.reduce((s, i) => s + i.quantity, 0);

    res.status(201).json(
      limpar({
        transfer: primeira.transferencia,
        transfers: feitas.map((r) => r.transferencia),
        message:
          feitas.length === 1
            ? `${itens[0].quantity} un. de ${primeira.produto.name} transferidas da ${primeira.origem.name} para a ${primeira.destino.name}.`
            : `${feitas.length} produtos · ${pecas} peça(s) transferidas da ${primeira.origem.name} para a ${primeira.destino.name}.`,
      }),
    );
  }),
);

const filtroTransferencias = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['PENDENTE', 'EM_TRANSITO', 'RECEBIDA', 'CANCELADA']).optional(),
  unitId: z.string().uuid().optional(),
});

rotasMovimentacoes.get(
  '/transferencias',
  rota(async (req, res) => {
    const q = validar(filtroTransferencias, semVazios(req.query));
    const p = paginacao(q as Record<string, unknown>);
    const unidade = unidadePermitida(req.usuario, q.unitId);

    const where: Prisma.StockTransferWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(unidade ? { OR: [{ originUnitId: unidade }, { destinationUnitId: unidade }] } : {}),
    };

    const [lista, total] = await Promise.all([
      db.stockTransfer.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, model: true } },
          originUnit: { select: { id: true, name: true } },
          destinationUnit: { select: { id: true, name: true } },
        },
      }),
      db.stockTransfer.count({ where }),
    ]);

    res.json(limpar(paginado(lista, total, p)));
  }),
);

rotasMovimentacoes.post(
  '/transferencias/:id/cancelar',
  somenteAdmin,
  rota(async (req, res) => {
    const t = await cancelarTransferencia(req.params.id, req.usuario);
    await registrarLog({ acao: 'CANCEL', entidade: 'StockTransfer', id: t.id, req });
    res.json({ message: 'Transferência cancelada e estoque devolvido à origem.' });
  }),
);

// -------------------------------------------------- Retirada para a loja

const retiradaSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  unitId: z.string().uuid('Selecione a unidade'),
  quantity: z.coerce.number().int().min(1, 'A quantidade deve ser no mínimo 1'),
  notes: z.string().trim().max(1000).optional().nullable(),
});

rotasMovimentacoes.post(
  '/retirada',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(retiradaSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.unitId);
    await exigirQuantidade(dados.productId);

    const produto = await db.product.findUnique({ where: { id: dados.productId } });
    if (!produto) throw naoEncontrado('Produto');

    const livre = await disponivel(dados.productId, dados.unitId);
    if (livre < dados.quantity) {
      const unidade = await db.unit.findUnique({ where: { id: dados.unitId } });
      throw new AppError(
        `Só há ${livre} unidade(s) livres na ${unidade?.name ?? 'unidade'} — o restante já está em outra retirada pendente.`,
      );
    }

    const retirada = await db.stockWithdrawal.create({
      data: {
        productId: produto.id,
        unitId: dados.unitId,
        quantity: dados.quantity,
        notes: dados.notes ?? null,
        requestedById: req.usuario?.id ?? null,
      },
      include: { unit: { select: { name: true } } },
    });

    await registrarLog({ acao: 'RETIRADA', entidade: 'StockWithdrawal', id: retirada.id, req });

    res.status(201).json(
      limpar({
        withdrawal: retirada,
        message:
          `${dados.quantity} un. de ${produto.name} reservadas para a loja. ` +
          'O estoque só será baixado quando você aprovar.',
      }),
    );
  }),
);

const filtroRetiradas = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['PENDENTE', 'APROVADA', 'CANCELADA']).optional(),
  unitId: z.string().uuid().optional(),
});

rotasMovimentacoes.get(
  '/retiradas',
  rota(async (req, res) => {
    const q = validar(filtroRetiradas, semVazios(req.query));
    const p = paginacao(q as Record<string, unknown>);
    const unidade = unidadePermitida(req.usuario, q.unitId);

    const where: Prisma.StockWithdrawalWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(unidade ? { unitId: unidade } : {}),
    };

    const [lista, total] = await Promise.all([
      db.stockWithdrawal.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          product: { select: { id: true, name: true, model: true } },
          unit: { select: { id: true, name: true } },
        },
      }),
      db.stockWithdrawal.count({ where }),
    ]);

    res.json(limpar(paginado(lista, total, p)));
  }),
);

const aprovarSchema = z.object({
  soldQuantity: z.coerce.number().int().min(0, 'Informe quantas saíram'),
  notes: z.string().trim().max(1000).optional().nullable(),
});

rotasMovimentacoes.post(
  '/retiradas/:id/aprovar',
  exigir('retirada.aprovar'),
  rota(async (req, res) => {
    const { soldQuantity, notes } = validar(aprovarSchema, req.body);

    const resultado = await db.$transaction(async (tx) => {
      const retirada = await tx.stockWithdrawal.findUnique({
        where: { id: req.params.id },
        include: { product: true, unit: true },
      });

      if (!retirada) throw naoEncontrado('Retirada');
      if (retirada.status !== 'PENDENTE') throw new AppError('Esta retirada já foi fechada.');
      if (soldQuantity > retirada.quantity) {
        throw new AppError(
          `Você retirou ${retirada.quantity} un. — não é possível informar ${soldQuantity} vendidas.`,
        );
      }

      exigirAcessoNaUnidade(req.usuario, retirada.unitId);

      const devolvidas = retirada.quantity - soldQuantity;

      await tx.stockWithdrawal.update({
        where: { id: retirada.id },
        data: {
          status: 'APROVADA',
          soldQuantity,
          returnedQuantity: devolvidas,
          approvedAt: new Date(),
          approvedById: req.usuario?.id ?? null,
          notes: notes ?? retirada.notes,
        },
      });

      let saldo: { antes: number; depois: number } | null = null;

      if (soldQuantity > 0) {
        saldo = await movimentar({
          produtoId: retirada.productId,
          produtoNome: retirada.product.name,
          unidadeId: retirada.unitId,
          tipo: 'SAIDA',
          motivo: 'RETIRADA',
          quantidade: soldQuantity,
          observacao:
            `Retirada para a loja aprovada — ${soldQuantity} de ${retirada.quantity} saíram` +
            (devolvidas ? `, ${devolvidas} voltaram ao estoque` : ''),
          withdrawalId: retirada.id,
          referenciaId: retirada.id,
          usuarioId: req.usuario?.id,
          usuarioNome: req.usuario?.nome,
          tx,
        });
      }

      return { retirada, soldQuantity, devolvidas, saldo };
    });

    await registrarLog({ acao: 'APROVAR_RETIRADA', entidade: 'StockWithdrawal', id: req.params.id, req });

    res.json({
      message:
        resultado.soldQuantity === 0
          ? `Nenhuma unidade saiu — as ${resultado.retirada.quantity} voltaram ao estoque.`
          : `${resultado.soldQuantity} un. baixadas do estoque` +
            (resultado.devolvidas ? ` · ${resultado.devolvidas} voltaram` : '') +
            (resultado.saldo ? ` · saldo: ${resultado.saldo.antes} → ${resultado.saldo.depois}` : ''),
    });
  }),
);

const recusaSchema = z.object({
  motivo: z.string().trim().max(1000).optional().nullable(),
});

rotasMovimentacoes.post(
  '/retiradas/:id/cancelar',
  exigir('retirada.aprovar'),
  rota(async (req, res) => {
    const retirada = await db.stockWithdrawal.findUnique({ where: { id: req.params.id } });
    if (!retirada) throw naoEncontrado('Retirada');
    if (retirada.status !== 'PENDENTE') throw new AppError('Esta retirada já foi fechada.');

    exigirAcessoNaUnidade(req.usuario, retirada.unitId);

    const { motivo } = validar(recusaSchema, req.body ?? {});

    await db.stockWithdrawal.update({
      where: { id: retirada.id },
      data: {
        status: 'CANCELADA',
        soldQuantity: 0,
        returnedQuantity: retirada.quantity,
        approvedAt: new Date(),
        approvedById: req.usuario?.id ?? null,
        notes: motivo ?? retirada.notes,
      },
    });

    await registrarLog({ acao: 'CANCELAR_RETIRADA', entidade: 'StockWithdrawal', id: retirada.id, req });
    res.json({ message: `Retirada recusada — as ${retirada.quantity} un. seguem no estoque.` });
  }),
);

// ---------------------------------------------------------------- Histórico

const filtros = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  type: z.enum(['ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE']).optional(),
  reason: z.enum(MOTIVOS).optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type FiltrosMovimento = z.infer<typeof filtros>;

export async function filtrarMovimentacoes(
  q: FiltrosMovimento,
  unidade?: string,
): Promise<Prisma.StockMovementWhereInput> {
  const cond: Prisma.StockMovementWhereInput[] = [];

  if (q.search) {
    cond.push({
      OR: [
        { productName: contem(q.search) },
        { notes: contem(q.search) },
        { product: { model: contem(q.search) } },
      ],
    });
  }

  if (q.type) cond.push({ type: q.type });
  if (q.reason) cond.push({ reason: q.reason });
  if (q.productId) cond.push({ productId: q.productId });
  if (q.userId) cond.push({ userId: q.userId });
  if (q.categoryId) cond.push({ product: { categoryId: { in: await comAsFilhas(q.categoryId) } } });
  if (unidade) cond.push({ unitId: unidade });

  const periodo = intervalo(q.startDate, q.endDate);
  if (periodo) cond.push({ createdAt: periodo });

  return cond.length ? { AND: cond } : {};
}

rotasMovimentacoes.get(
  '/',
  rota(async (req, res) => {
    const q = validar(filtros, semVazios(req.query));
    const p = paginacao(q as Record<string, unknown>);
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const where = await filtrarMovimentacoes(q, unidade);

    const [lista, total, agrupado] = await Promise.all([
      db.stockMovement.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: q.sortOrder === 'asc' ? 'asc' : 'desc' },
        include: {
          user: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
          product: {
            select: { id: true, name: true, model: true, category: { select: { name: true } } },
          },
        },
      }),
      db.stockMovement.count({ where }),
      db.stockMovement.groupBy({ by: ['type'], where, _sum: { quantity: true }, _count: true }),
    ]);

    const unidades = await db.unit.findMany({ select: { id: true, name: true } });
    const nome = (id?: string | null) => unidades.find((u) => u.id === id)?.name ?? null;

    res.json(
      limpar({
        ...paginado(
          lista.map((m) => ({
            ...m,
            originUnitName: nome(m.originUnitId),
            destinationUnitName: nome(m.destinationUnitId),
          })),
          total,
          p,
        ),
        summary: Object.fromEntries(
          agrupado.map((g) => [g.type, { count: g._count, quantity: g._sum.quantity ?? 0 }]),
        ),
      }),
    );
  }),
);

// ------------------------------------------------------------------ Ajuste

const ajusteSchema = z.object({
  productId: z.string().uuid(),
  unitId: z.string().uuid(),
  newQuantity: z.coerce.number().int().min(0, 'O saldo não pode ser negativo'),
  notes: z.string().trim().min(3, 'Explique o motivo da correção').max(1000),
});

rotasMovimentacoes.post(
  '/ajuste',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(ajusteSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.unitId);
    await exigirQuantidade(dados.productId);

    const produto = await db.product.findUnique({ where: { id: dados.productId } });
    if (!produto) throw naoEncontrado('Produto');

    const atual = await db.stock.findUnique({
      where: { productId_unitId: { productId: dados.productId, unitId: dados.unitId } },
    });
    const saldoAtual = atual?.quantity ?? 0;
    const diferenca = dados.newQuantity - saldoAtual;

    if (diferenca === 0) {
      throw new AppError(`O saldo já é ${saldoAtual}. Nada a corrigir.`);
    }

    const resultado = await movimentar({
      produtoId: produto.id,
      produtoNome: produto.name,
      unidadeId: dados.unitId,
      tipo: 'AJUSTE',
      motivo: 'AJUSTE',
      sentido: diferenca > 0 ? 'entra' : 'sai',
      quantidade: Math.abs(diferenca),
      observacao: dados.notes,
      usuarioId: req.usuario?.id,
      usuarioNome: req.usuario?.nome,
    });

    await registrarLog({ acao: 'AJUSTE', entidade: 'Stock', id: produto.id, req });
    res.json({ ...resultado, message: `Saldo corrigido de ${saldoAtual} para ${dados.newQuantity}.` });
  }),
);
