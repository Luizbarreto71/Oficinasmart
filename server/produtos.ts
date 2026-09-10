import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth.js';
import { AppError, contem, limpar, naoEncontrado, ordenar, paginacao, paginado, rota, validar, semVazios } from './core.js';
import { db, registrarLog } from './db.js';
import { exigir } from './permissoes.js';
import { comAsFilhas, estoqueBaixo, movimentar, saldo, sincronizarSaldoUnitario } from './estoque.js';
import { unidadeDeVenda } from './sistema.js';
import { exigirAcessoNaUnidade, unidadePermitida } from './unidades.js';

/** Cadastro, busca, edição, ajuste de estoque e exclusão de produtos. */

export const rotasProdutos = Router();
rotasProdutos.use(autenticar, exigir('produtos.ver'));

const COM_RELACOES = {
  category: true,
  supplier: true,
  photos: { select: { id: true }, orderBy: { createdAt: 'asc' } as const },
  stock: { include: { unit: { select: { id: true, name: true, type: true } } } },
  _count: { select: { devices: { where: { status: 'EM_ESTOQUE' } } } },
} satisfies Prisma.ProductInclude;

type ProdutoCru = Prisma.ProductGetPayload<{ include: typeof COM_RELACOES }>;

/** Formata o produto para o frontend. */
function formatar<T extends ProdutoCru>(produto: T, unidadeId?: string) {
  const porUnidade = produto.stock.map((linha) => ({
    unitId: linha.unitId,
    unitName: linha.unit.name,
    quantity: linha.quantity,
  }));

  const total = porUnidade.reduce((soma, u) => soma + u.quantity, 0);
  const daUnidade = unidadeId
    ? (porUnidade.find((u) => u.unitId === unidadeId)?.quantity ?? 0)
    : total;

  return limpar({
    ...produto,
    photos: produto.photos.map((f) => `/api/fotos/${f.id}`),
    stock: porUnidade,
    totalQuantity: total,
    quantity: daUnidade,
    devicesEmEstoque: produto._count.devices,
  });
}

const ORDENAVEIS = [
  'name',
  'brand',
  'model',
  'costPrice',
  'salePrice',
  'status',
  'entryDate',
  'createdAt',
  'category.name',
  'supplier.name',
];

// ------------------------------------------------------------------ Schemas

const texto = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => v || null);

/**
 * Converte o que o formulário mandar num número — ou em `undefined` se não der.
 * Aceita `""`, `null`, `NaN` e o formato brasileiro ("350,00", "1.200,50").
 * Assim um campo em branco ou meio digitado vira o padrão em vez de estourar 422.
 */
const paraNumero = (v: unknown): unknown => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return undefined;
    const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\s/g, '');
    const n = Number(normal);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const dinheiro = z.preprocess(
  paraNumero,
  z.number().min(0, 'O valor não pode ser negativo').max(99_999_999),
);

/** Dinheiro que pode faltar ou vir vazio de propósito (ex.: preço de atacado). */
const dinheiroOpcional = z.preprocess(
  paraNumero,
  z.number().min(0, 'O valor não pode ser negativo').max(99_999_999).nullish(),
);

/** Dinheiro que sempre tem valor: entrada bagunçada cai no padrão, nunca 422. */
const dinheiroPadrao = (padrao: number) =>
  z.preprocess(paraNumero, z.number().min(0).max(99_999_999)).catch(padrao).default(padrao);

/** Inteiro ≥ 0 que sempre tem valor: entrada bagunçada cai no padrão. */
const inteiroPadrao = (padrao: number) =>
  z.preprocess(paraNumero, z.number().int().min(0)).catch(padrao).default(padrao);

/** Inteiro ≥ 0 que pode faltar ou vir vazio (ex.: garantia padrão em dias). */
const inteiroOpcional = (max: number) =>
  z.preprocess(paraNumero, z.number().int().min(0).max(max).nullish());

const foto = z.string().max(4_000_000);

/** Um aparelho informado no cadastro de um produto UNITARIO. */
const aparelhoNoCadastro = z.object({
  imei: z.string().trim().max(40).optional().nullable(),
  imei2: z.string().trim().max(40).optional().nullable(),
  serialNumber: z.string().trim().max(60).optional().nullable(),
  condicao: z.string().trim().max(40).optional().nullable(),
  batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
  warrantyUntil: z.coerce.date().optional().nullable(),
  costPrice: dinheiroOpcional,
  salePrice: dinheiroOpcional,
  imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const produtoSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do produto').max(180),
  categoryId: z.string().uuid('Selecione uma categoria'),
  supplierId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  brand: texto,
  model: texto,
  color: texto,
  capacity: texto,
  ram: texto,
  lote: texto,
  condicao: texto,
  tipoControle: z.enum(['UNITARIO', 'QUANTIDADE']).default('QUANTIDADE'),
  semEstoque: z.coerce.boolean().optional(),
  garantiaPadraoDias: inteiroOpcional(3650),
  quantity: inteiroPadrao(0),
  unitId: z.string().uuid().optional().nullable(),
  minQuantity: inteiroPadrao(1),
  costPrice: dinheiroPadrao(0),
  salePrice: dinheiroPadrao(0),
  wholesalePrice: dinheiroOpcional,
  imei: texto,
  serialNumber: texto,
  barcode: texto,
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['EM_ESTOQUE', 'RESERVADO', 'VENDIDO']).default('EM_ESTOQUE'),
  entryDate: z.coerce.date().optional(),
  photos: z.array(foto).max(8).optional(),
  /** Só para produto UNITARIO: os aparelhos que estão entrando no cadastro. */
  aparelhos: z.array(aparelhoNoCadastro).max(50).optional(),
});

const alterarSchema = produtoSchema.partial().extend({ reason: z.string().trim().max(200).optional() });

const filtrosSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: z.enum(['EM_ESTOQUE', 'RESERVADO', 'VENDIDO']).optional(),
  tipoControle: z.enum(['UNITARIO', 'QUANTIDADE']).optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  condicao: z.string().trim().optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  unitId: z.string().uuid().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type FiltrosProduto = z.infer<typeof filtrosSchema>;

export async function filtrarProdutos(
  q: FiltrosProduto,
  unidadeId?: string,
): Promise<Prisma.ProductWhereInput> {
  const cond: Prisma.ProductWhereInput[] = [];

  if (q.search) {
    cond.push({
      OR: [
        { name: contem(q.search) },
        { brand: contem(q.search) },
        { model: contem(q.search) },
        { imei: contem(q.search) },
        { serialNumber: contem(q.search) },
        { lote: contem(q.search) },
        { condicao: contem(q.search) },
        { barcode: contem(q.search) },
        { color: contem(q.search) },
        { supplier: { name: contem(q.search) } },
        { category: { name: contem(q.search) } },
        { devices: { some: { OR: [{ imei: contem(q.search) }, { serialNumber: contem(q.search) }] } } },
      ],
    });
  }

  if (q.categoryId) cond.push({ categoryId: { in: await comAsFilhas(q.categoryId) } });
  if (q.supplierId) cond.push({ supplierId: q.supplierId });
  if (q.tipoControle) cond.push({ tipoControle: q.tipoControle });
  if (q.status) cond.push({ status: q.status });
  else cond.push({ status: { not: 'VENDIDO' } });
  if (q.brand) cond.push({ brand: contem(q.brand) });
  if (q.model) cond.push({ model: contem(q.model) });
  if (q.condicao === '__sem__') cond.push({ OR: [{ condicao: null }, { condicao: '' }] });
  else if (q.condicao) cond.push({ condicao: q.condicao });
  if (q.lowStock === 'true') {
    const baixos = await estoqueBaixo(unidadeId, 500);
    cond.push({ id: { in: baixos.map((b) => b.productId) } });
  }

  if (unidadeId) cond.push({ OR: [{ stock: { some: { unitId: unidadeId } } }, { semEstoque: true }] });

  return cond.length ? { AND: cond } : {};
}

// -------------------------------------------------------------------- Fotos

function separarFotos(fotos: string[]) {
  const manter: string[] = [];
  const novas: { data: Buffer; mimeType: string }[] = [];

  for (const item of fotos) {
    const base64 = item.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);

    if (base64) {
      novas.push({ mimeType: base64[1], data: Buffer.from(base64[2], 'base64') });
      continue;
    }

    const id = item.match(/\/api\/fotos\/([0-9a-f-]{36})$/i);
    if (id) manter.push(id[1]);
  }

  return { manter, novas };
}

// ------------------------------------------------------------------- Rotas

/** Busca instantânea do topo da tela. */
rotasProdutos.get(
  '/search',
  rota(async (req, res) => {
    const termo = String(req.query.q ?? '').trim();
    if (termo.length < 2) {
      res.json({ products: [], sales: [], customers: [] });
      return;
    }

    const t = contem(termo);

    const [produtos, vendas, clientes] = await Promise.all([
      db.product.findMany({
        where: {
          OR: [
            { name: t },
            { brand: t },
            { model: t },
            { imei: t },
            { serialNumber: t },
            { lote: t },
            { barcode: t },
            { supplier: { name: t } },
            { devices: { some: { OR: [{ imei: t }, { serialNumber: t }] } } },
          ],
        },
        include: COM_RELACOES,
        take: 8,
        orderBy: { updatedAt: 'desc' },
      }),
      db.sale.findMany({
        where: { OR: [{ customerName: t }, { customerPhone: t }, { items: { some: { productName: t } } }] },
        include: { items: { select: { productName: true } } },
        take: 5,
        orderBy: { saleDate: 'desc' },
      }),
      db.customer.findMany({
        where: { OR: [{ name: t }, { phone: t }] },
        take: 5,
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({
      products: produtos.map((produto) => formatar(produto)),
      sales: limpar(vendas),
      customers: limpar(clientes),
    });
  }),
);

/** Marcas e modelos existentes, para alimentar os filtros. */
rotasProdutos.get(
  '/filters',
  rota(async (_req, res) => {
    const [marcas, modelos] = await Promise.all([
      db.product.findMany({
        where: { brand: { not: null } },
        distinct: ['brand'],
        select: { brand: true },
        orderBy: { brand: 'asc' },
      }),
      db.product.findMany({
        where: { model: { not: null } },
        distinct: ['model'],
        select: { model: true },
        orderBy: { model: 'asc' },
      }),
    ]);

    res.json({
      brands: marcas.map((m) => m.brand).filter(Boolean),
      models: modelos.map((m) => m.model).filter(Boolean),
    });
  }),
);

rotasProdutos.get(
  '/',
  rota(async (req, res) => {
    const q = validar(filtrosSchema, semVazios(req.query));
    const p = paginacao(q as Record<string, unknown>);
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const where = await filtrarProdutos(q, unidade);

    const ordem = q.sortBy === 'quantity' ? 'name' : q.sortBy;

    const { condicao: _naFrente, ...semCondicao } = q;
    const wherePorCondicao = await filtrarProdutos(semCondicao as typeof q, unidade);

    const [lista, total, condicoes] = await Promise.all([
      db.product.findMany({
        where,
        include: COM_RELACOES,
        skip: p.skip,
        take: p.take,
        orderBy: ordenar(ordem, q.sortOrder, ORDENAVEIS, { createdAt: 'desc' }) as never,
      }),
      db.product.count({ where }),
      db.product.groupBy({ by: ['condicao'], where: wherePorCondicao, _count: true }),
    ]);

    res.json({
      ...paginado(lista.map((produto) => formatar(produto, unidade)), total, p),
      condicoes: condicoes.map((c) => ({ condicao: c.condicao, produtos: c._count })),
    });
  }),
);

rotasProdutos.get(
  '/:id',
  rota(async (req, res) => {
    const produto = await db.product.findUnique({
      where: { id: req.params.id },
      include: {
        ...COM_RELACOES,
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { name: true } }, unit: { select: { name: true } } },
        },
        saleItems: {
          orderBy: { sale: { saleDate: 'desc' } },
          take: 10,
          include: {
            sale: {
              select: { code: true, saleDate: true, customerName: true, unit: { select: { name: true } } },
            },
          },
        },
        devices: {
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          take: 200,
          include: { unit: { select: { id: true, name: true } } },
        },
      },
    });

    if (!produto) throw naoEncontrado('Produto');

    res.json({
      ...formatar(produto),
      movements: limpar(produto.movements),
      saleItems: limpar(produto.saleItems),
      devices: limpar(produto.devices),
    });
  }),
);

// ------------------------------------------------------ helpers de aparelho

/** Cria N aparelhos de um produto UNITARIO numa unidade e sincroniza o saldo. */
async function darEntradaDeAparelhos(
  tx: Prisma.TransactionClient,
  produto: { id: string; name: string; costPrice: Prisma.Decimal; salePrice: Prisma.Decimal; garantiaPadraoDias: number | null },
  unidadeId: string,
  aparelhos: z.infer<typeof aparelhoNoCadastro>[],
  usuario: { id?: string; nome?: string },
  observacao: string,
): Promise<{ criados: number; medio: number }> {
  for (const a of aparelhos) {
    const garantia =
      a.warrantyUntil ??
      (produto.garantiaPadraoDias
        ? new Date(Date.now() + produto.garantiaPadraoDias * 86_400_000)
        : null);

    await tx.deviceUnit.create({
      data: {
        productId: produto.id,
        unitId: unidadeId,
        imei: a.imei?.trim() || null,
        imei2: a.imei2?.trim() || null,
        serialNumber: a.serialNumber?.trim() || null,
        condicao: a.condicao?.trim() || null,
        batteryHealth: a.batteryHealth ?? null,
        warrantyUntil: garantia,
        costPrice: new Prisma.Decimal(a.costPrice ?? Number(produto.costPrice)),
        salePrice: a.salePrice != null ? new Prisma.Decimal(a.salePrice) : null,
        imeiSituacao: a.imeiSituacao ?? 'NAO_CONSULTADO',
        imeiCheckedAt: a.imeiSituacao && a.imeiSituacao !== 'NAO_CONSULTADO' ? new Date() : null,
        notes: a.notes?.trim() || null,
        status: 'EM_ESTOQUE',
      },
    });
  }

  await sincronizarSaldoUnitario(produto.id, unidadeId, tx);

  const antes = await saldo(produto.id, unidadeId, tx);
  const depois = await tx.deviceUnit.count({
    where: { productId: produto.id, unitId: unidadeId, status: 'EM_ESTOQUE' },
  });

  await tx.stockMovement.create({
    data: {
      type: 'ENTRADA',
      reason: 'CADASTRO',
      quantity: aparelhos.length,
      previousQuantity: Math.max(0, antes - aparelhos.length),
      newQuantity: depois,
      productId: produto.id,
      productName: produto.name,
      unitId: unidadeId,
      userId: usuario.id ?? null,
      notes: observacao,
    },
  });

  const media = await tx.deviceUnit.aggregate({
    where: { productId: produto.id, status: 'EM_ESTOQUE' },
    _avg: { costPrice: true },
  });
  const medio = media._avg.costPrice ? Number(media._avg.costPrice) : Number(produto.costPrice);

  await tx.product.update({ where: { id: produto.id }, data: { costPrice: new Prisma.Decimal(medio) } });

  return { criados: aparelhos.length, medio };
}

// ------------------------------------------------------------------- Rotas

rotasProdutos.post(
  '/',
  exigir('produtos.editar'),
  rota(async (req, res) => {
    const { photos, quantity, unitId, aparelhos, ...dados } = validar(produtoSchema, req.body);
    const { novas } = separarFotos(photos ?? []);

    let unidadeDestino = unitId ?? req.usuario?.unidadeId ?? null;
    if (!unidadeDestino) {
      const matriz = await db.unit.findFirst({
        where: { active: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
      unidadeDestino = matriz?.id ?? null;
    }

    const unitario = dados.tipoControle === 'UNITARIO';
    const semEstoque = Boolean(dados.semEstoque);
    const entrando = unitario ? (aparelhos?.length ?? 0) : quantity;

    if (entrando > 0 && !unidadeDestino && !semEstoque) {
      throw new AppError('Cadastre uma unidade antes de lançar estoque.');
    }

    if (unidadeDestino) {
      const destino = await db.unit.findUnique({ where: { id: unidadeDestino } });
      if (!destino) throw naoEncontrado('Unidade');
      if (!destino.active) throw new AppError(`A unidade ${destino.name} está desativada.`);
      exigirAcessoNaUnidade(req.usuario, unidadeDestino);
    }

    // IMEI duplicado: barra antes de criar nada.
    if (unitario && aparelhos?.length) {
      const imeis = aparelhos.map((a) => a.imei?.trim()).filter((v): v is string => Boolean(v));
      const repetidoAqui = imeis.find((v, i) => imeis.indexOf(v) !== i);
      if (repetidoAqui) throw new AppError(`O IMEI ${repetidoAqui} foi informado duas vezes.`);
      if (imeis.length) {
        const jaExiste = await db.deviceUnit.findFirst({
          where: { imei: { in: imeis } },
          select: { imei: true, product: { select: { name: true } } },
        });
        if (jaExiste) {
          throw new AppError(`O IMEI ${jaExiste.imei} já está cadastrado em "${jaExiste.product.name}".`);
        }
      }
    }

    const criado = await db.$transaction(async (tx) => {
      const produto = await tx.product.create({
        data: {
          ...dados,
          semEstoque,
          supplierId: dados.supplierId || null,
          photos: novas.length ? { create: novas } : undefined,
        },
      });

      if (unitario && aparelhos?.length && unidadeDestino) {
        await darEntradaDeAparelhos(
          tx,
          {
            id: produto.id,
            name: produto.name,
            costPrice: produto.costPrice,
            salePrice: produto.salePrice,
            garantiaPadraoDias: produto.garantiaPadraoDias,
          },
          unidadeDestino,
          aparelhos,
          { id: req.usuario?.id, nome: req.usuario?.nome },
          'Estoque inicial do cadastro',
        );
      } else if (!unitario && quantity > 0 && unidadeDestino && !semEstoque) {
        await movimentar({
          produtoId: produto.id,
          produtoNome: produto.name,
          unidadeId: unidadeDestino,
          tipo: 'ENTRADA',
          motivo: 'CADASTRO',
          quantidade: quantity,
          observacao: 'Estoque inicial do cadastro',
          usuarioId: req.usuario?.id,
          usuarioNome: req.usuario?.nome,
          tx,
        });
      }

      return produto;
    });

    await registrarLog({ acao: 'CREATE', entidade: 'Product', id: criado.id, req });

    const completo = await db.product.findUnique({ where: { id: criado.id }, include: COM_RELACOES });
    res.status(201).json(formatar(completo!));
  }),
);

rotasProdutos.put(
  '/:id',
  exigir('produtos.editar'),
  rota(async (req, res) => {
    const { photos, reason, quantity, unitId, aparelhos: _ignora, tipoControle: _tc, ...dados } =
      validar(alterarSchema, req.body);

    const atual = await db.product.findUnique({ where: { id: req.params.id }, include: COM_RELACOES });
    if (!atual) throw naoEncontrado('Produto');

    const produto = await db.$transaction(async (tx) => {
      if (photos) {
        const { manter, novas } = separarFotos(photos);

        await tx.productPhoto.deleteMany({
          where: { productId: atual.id, id: { notIn: manter.length ? manter : ['-'] } },
        });

        if (novas.length) {
          await tx.productPhoto.createMany({
            data: novas.map((f) => ({ ...f, productId: atual.id })),
          });
        }
      }

      return tx.product.update({
        where: { id: atual.id },
        data: {
          ...dados,
          supplierId: dados.supplierId === undefined ? undefined : dados.supplierId || null,
        },
        include: COM_RELACOES,
      });
    });

    // Ajuste numérico de quantidade: só para produto QUANTIDADE.
    let ajuste: { antes: number; depois: number; unidade: string } | null = null;

    if (quantity !== undefined && atual.tipoControle === 'QUANTIDADE') {
      const unidade = unitId ?? req.usuario?.unidadeId ?? (await unidadeDeVenda())?.id;
      if (!unidade) throw new AppError('Escolha a unidade onde a quantidade será corrigida.');

      const antes = await saldo(produto.id, unidade);
      const diferenca = quantity - antes;

      if (diferenca !== 0) {
        const nomeDaUnidade =
          (await db.unit.findUnique({ where: { id: unidade }, select: { name: true } }))?.name ?? 'unidade';

        await movimentar({
          produtoId: produto.id,
          produtoNome: produto.name,
          unidadeId: unidade,
          tipo: diferenca > 0 ? 'ENTRADA' : 'SAIDA',
          motivo: 'AJUSTE',
          quantidade: Math.abs(diferenca),
          observacao: reason?.trim() || `Quantidade corrigida no cadastro: ${antes} → ${quantity}`,
          usuarioId: req.usuario?.id,
          usuarioNome: req.usuario?.nome,
        });

        ajuste = { antes, depois: quantity, unidade: nomeDaUnidade };
      }
    } else if (quantity !== undefined && atual.tipoControle === 'UNITARIO') {
      throw new AppError(
        'Este produto é controlado por aparelho. Ajuste o estoque adicionando ou removendo aparelhos na aba "Aparelhos".',
      );
    }

    await registrarLog({
      acao: 'UPDATE',
      entidade: 'Product',
      id: produto.id,
      alteracoes: { motivo: reason, ...(ajuste ? { estoque: ajuste } : {}) },
      req,
    });

    const completo = ajuste
      ? await db.product.findUnique({ where: { id: produto.id }, include: COM_RELACOES })
      : produto;

    res.json({
      ...formatar(completo!),
      ...(ajuste
        ? { message: `Estoque da ${ajuste.unidade}: ${ajuste.antes} → ${ajuste.depois}.` }
        : {}),
    });
  }),
);

/** Entrada ou baixa avulsa numa unidade (produto QUANTIDADE), sempre com motivo. */
rotasProdutos.patch(
  '/:id/stock',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const { quantity, reason, unitId } = validar(
      z.object({
        quantity: z.coerce.number().int().refine((v) => v !== 0, 'Informe uma quantidade diferente de zero'),
        reason: z.string().trim().min(3, 'Informe o motivo do ajuste').max(200),
        unitId: z.string().uuid('Selecione a unidade').optional(),
      }),
      req.body,
    );

    const unidade = unitId ?? req.usuario?.unidadeId;
    if (!unidade) throw new AppError('Selecione a unidade onde o estoque será ajustado.');

    const produto = await db.product.findUnique({ where: { id: req.params.id } });
    if (!produto) throw naoEncontrado('Produto');
    if (produto.tipoControle === 'UNITARIO') {
      throw new AppError('Produto controlado por aparelho: use a aba "Aparelhos".');
    }

    await movimentar({
      produtoId: produto.id,
      produtoNome: produto.name,
      unidadeId: unidade,
      tipo: quantity > 0 ? 'ENTRADA' : 'SAIDA',
      motivo: 'AJUSTE',
      quantidade: Math.abs(quantity),
      observacao: reason,
      usuarioId: req.usuario?.id,
      usuarioNome: req.usuario?.nome,
    });

    await registrarLog({ acao: 'ADJUST_STOCK', entidade: 'Product', id: produto.id, req });

    const completo = await db.product.findUnique({ where: { id: produto.id }, include: COM_RELACOES });
    res.json(formatar(completo!));
  }),
);

rotasProdutos.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const produto = await db.product.findUnique({ where: { id: req.params.id }, include: COM_RELACOES });
    if (!produto) throw naoEncontrado('Produto');

    const motivo = (req.query.reason as string) || 'Produto excluído do sistema';

    for (const linha of produto.stock) {
      if (linha.quantity <= 0) continue;
      if (produto.tipoControle === 'UNITARIO') {
        await db.deviceUnit.updateMany({
          where: { productId: produto.id, unitId: linha.unitId, status: 'EM_ESTOQUE' },
          data: { status: 'DEVOLVIDO' },
        });
        await db.$transaction((tx) => sincronizarSaldoUnitario(produto.id, linha.unitId, tx));
        await db.stockMovement.create({
          data: {
            type: 'SAIDA', reason: 'EXCLUSAO', quantity: linha.quantity,
            previousQuantity: linha.quantity, newQuantity: 0,
            productId: produto.id, productName: produto.name, unitId: linha.unitId,
            userId: req.usuario?.id ?? null, notes: motivo,
          },
        });
      } else {
        await movimentar({
          produtoId: produto.id,
          produtoNome: produto.name,
          unidadeId: linha.unitId,
          tipo: 'SAIDA',
          motivo: 'EXCLUSAO',
          quantidade: linha.quantity,
          observacao: motivo,
          usuarioId: req.usuario?.id,
          usuarioNome: req.usuario?.nome,
        });
      }
    }

    const vendas = await db.saleItem.count({ where: { productId: produto.id } });
    if (vendas > 0) {
      await db.product.update({ where: { id: produto.id }, data: { status: 'VENDIDO' } });
      await registrarLog({ acao: 'ARCHIVE', entidade: 'Product', id: produto.id, req });
      res.json({
        message: 'Produto possui vendas registradas: estoque zerado e arquivado como vendido.',
        archived: true,
      });
      return;
    }

    await db.product.delete({ where: { id: produto.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'Product', id: produto.id, req });

    res.json({ message: 'Produto excluído com sucesso', archived: false });
  }),
);

// ------------------------------------------------------- Entrega das imagens

export const rotasFotos = Router();

rotasFotos.get(
  '/usuario/:id',
  rota(async (req, res) => {
    const usuario = await db.user.findUnique({
      where: { id: req.params.id },
      select: { foto: true, fotoMimeType: true },
    });
    if (!usuario?.foto || !usuario.fotoMimeType) throw naoEncontrado('Foto');

    res.setHeader('Content-Type', usuario.fotoMimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(usuario.foto));
  }),
);

rotasFotos.get(
  '/:id',
  rota(async (req, res) => {
    const foto = await db.productPhoto.findUnique({ where: { id: req.params.id } });
    if (!foto) throw naoEncontrado('Foto');

    res.setHeader('Content-Type', foto.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(foto.data));
  }),
);

export { darEntradaDeAparelhos, COM_RELACOES, formatar };
