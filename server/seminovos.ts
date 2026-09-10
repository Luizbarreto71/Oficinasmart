import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth.js';
import { AppError, limpar, naoEncontrado, numero, paginacao, paginado, rota, validar } from './core.js';
import { db, registrarLog } from './db.js';
import { sincronizarSaldoUnitario } from './estoque.js';
import { exigir } from './permissoes.js';
import { unidadePermitida } from './unidades.js';

/**
 * Aparelhos usados que a loja recebeu.
 *
 * Não são um estoque à parte: cada seminovo é um produto normal (controlado
 * por aparelho), entra na prateleira, aparece nos relatórios e é vendido
 * como qualquer outro. A marca no cadastro só serve para reuni-los nesta
 * aba.
 */

export const rotasSeminovos = Router();
rotasSeminovos.use(autenticar, exigir('produtos.ver'));

type Cliente = Prisma.TransactionClient | typeof db;

/** A categoria onde os seminovos nascem, criada na primeira vez. */
async function categoriaDosSeminovos(cliente: Cliente): Promise<string> {
  const existente = await cliente.category.findFirst({
    where: { OR: [{ slug: 'seminovos' }, { name: { equals: 'Seminovos', mode: 'insensitive' } }] },
    select: { id: true },
  });
  if (existente) return existente.id;

  const nova = await cliente.category.create({
    data: { name: 'Seminovos', slug: 'seminovos', color: '#F59E0B', tipoControlePadrao: 'UNITARIO' },
    select: { id: true },
  });
  return nova.id;
}

const nomeDoAparelho = (modelo: string, armazenamento?: string | null): string =>
  [modelo.trim(), armazenamento?.trim()].filter(Boolean).join(' ');

/** Cria o produto UNITARIO + o aparelho e lança a entrada. */
async function criarSeminovo(
  tx: Prisma.TransactionClient,
  dados: {
    modelo: string;
    marca?: string | null;
    armazenamento?: string | null;
    cor?: string | null;
    imei?: string | null;
    batteryHealth?: number | null;
    valorPago: number;
    salePrice?: number | null;
    origem: string;
    notes?: string | null;
    condicao?: string | null;
  },
  unidadeId: string,
  usuarioId: string | null,
  tradeInAparelhoId?: string | null,
): Promise<{ id: string; name: string }> {
  const categoriaId = await categoriaDosSeminovos(tx);

  const produto = await tx.product.create({
    data: {
      name: nomeDoAparelho(dados.modelo, dados.armazenamento),
      brand: dados.marca ?? null,
      model: dados.modelo,
      color: dados.cor ?? null,
      capacity: dados.armazenamento ?? null,
      categoryId: categoriaId,
      tipoControle: 'UNITARIO',
      costPrice: new Prisma.Decimal(dados.valorPago),
      salePrice: new Prisma.Decimal(dados.salePrice ?? 0),
      seminovo: true,
      seminovoOrigem: dados.origem,
      notes: dados.notes ?? null,
    },
  });

  await tx.deviceUnit.create({
    data: {
      productId: produto.id,
      unitId: unidadeId,
      imei: dados.imei?.trim() || null,
      condicao: dados.condicao ?? 'Seminovo',
      batteryHealth: dados.batteryHealth ?? null,
      costPrice: new Prisma.Decimal(dados.valorPago),
      status: 'EM_ESTOQUE',
      tradeInAparelhoId: tradeInAparelhoId ?? null,
    },
  });

  await sincronizarSaldoUnitario(produto.id, unidadeId, tx);

  await tx.stockMovement.create({
    data: {
      type: 'ENTRADA',
      reason: 'COMPRA',
      quantity: 1,
      previousQuantity: 0,
      newQuantity: 1,
      unitCost: new Prisma.Decimal(dados.valorPago),
      productId: produto.id,
      productName: produto.name,
      unitId: unidadeId,
      userId: usuarioId,
      notes: dados.origem,
    },
  });

  return produto;
}

/**
 * Cadastra no estoque os aparelhos de uma troca que a loja aceitou.
 * Roda quando a troca vira venda.
 */
export async function seminovosDaTroca(
  tradeInId: string,
  unidadeId: string,
  usuarioId: string | null,
  cliente: Cliente = db,
): Promise<number> {
  const troca = await cliente.tradeIn.findUnique({
    where: { id: tradeInId },
    include: { aparelhos: { include: { produto: { select: { id: true } }, device: { select: { id: true } } } } },
  });
  if (!troca) return 0;

  let criados = 0;

  const executar = async (tx: Prisma.TransactionClient) => {
    for (const aparelho of troca.aparelhos) {
      if (aparelho.produto || aparelho.device) continue;

      await criarSeminovo(
        tx,
        {
          modelo: aparelho.modelo,
          marca: aparelho.marca,
          armazenamento: aparelho.armazenamento,
          cor: aparelho.cor,
          imei: aparelho.imei,
          valorPago: numero(aparelho.valorAvaliado),
          origem: `Troca ${troca.code} · ${troca.customerName}`,
          notes: aparelho.observacoes,
          condicao: aparelho.estado ?? 'Seminovo',
        },
        unidadeId,
        usuarioId,
        aparelho.id,
      );
      criados += 1;
    }
  };

  if ('$transaction' in cliente) {
    await (cliente as typeof db).$transaction(executar);
  } else {
    await executar(cliente as Prisma.TransactionClient);
  }

  return criados;
}

// ------------------------------------------------------------------ Listagem

const COM_ORIGEM = {
  category: { select: { id: true, name: true } },
  stock: { select: { unitId: true, quantity: true, unit: { select: { name: true } } } },
  devices: {
    select: {
      id: true,
      imei: true,
      status: true,
      batteryHealth: true,
      condicao: true,
      unit: { select: { name: true } },
      tradeInAparelho: {
        select: {
          estado: true,
          defeitos: true,
          imeiSituacao: true,
          tradeIn: { select: { id: true, code: true, customerName: true, createdAt: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

rotasSeminovos.get(
  '/',
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().trim().optional(),
        unitId: z.string().uuid().optional(),
        origem: z.enum(['troca', 'compra']).optional(),
        disponivel: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );

    const unidade = unidadePermitida(req.usuario, q.unitId);
    const p = paginacao(req.query as Record<string, unknown>, 30);

    const onde: Prisma.ProductWhereInput = {
      seminovo: true,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { seminovoOrigem: { contains: q.search, mode: 'insensitive' } },
              { devices: { some: { imei: { contains: q.search } } } },
            ],
          }
        : {}),
      ...(q.disponivel === 'true' ? { status: 'EM_ESTOQUE' } : {}),
      ...(unidade ? { OR: [{ stock: { some: { unitId: unidade } } }, { devices: { some: { unitId: unidade } } }] } : {}),
    };

    const [lista, total, emEstoque, investido] = await Promise.all([
      db.product.findMany({
        where: onde,
        include: COM_ORIGEM,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      }),
      db.product.count({ where: onde }),
      db.deviceUnit.count({ where: { product: { seminovo: true }, status: 'EM_ESTOQUE' } }),
      db.deviceUnit.aggregate({
        where: { product: { seminovo: true }, status: 'EM_ESTOQUE' },
        _sum: { costPrice: true },
      }),
    ]);

    res.json({
      ...paginado(
        lista.map((s) => ({
          ...limpar(s),
          quantidade: s.devices.filter((d) => d.status === 'EM_ESTOQUE').length,
          origem: s.devices.some((d) => d.tradeInAparelho) ? 'troca' : 'compra',
        })),
        total,
        p,
      ),
      resumo: {
        pecas: emEstoque,
        investido: numero(investido._sum.costPrice ?? 0),
      },
    });
  }),
);

// -------------------------------------------------------- Compra sem troca

const compraSchema = z.object({
  modelo: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120),
  marca: z.string().trim().max(60).optional().nullable(),
  armazenamento: z.string().trim().max(20).optional().nullable(),
  cor: z.string().trim().max(40).optional().nullable(),
  imei: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 15, 'O IMEI tem 15 números')
    .optional()
    .nullable(),
  batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
  valorPago: z.coerce.number().min(0, 'Informe quanto a loja pagou'),
  salePrice: z.coerce.number().min(0).optional(),
  unitId: z.string().uuid('Escolha a unidade onde o aparelho ficou'),
  vendedor: z.string().trim().max(180).optional().nullable(),
  observacoes: z.string().trim().max(2000).optional().nullable(),
});

rotasSeminovos.post(
  '/',
  exigir('produtos.editar'),
  rota(async (req, res) => {
    const dados = validar(compraSchema, req.body);

    if (dados.imei) {
      const repetido = await db.deviceUnit.findFirst({
        where: { imei: dados.imei },
        select: { product: { select: { name: true } } },
      });
      if (repetido) {
        throw new AppError(`Esse IMEI já está cadastrado em "${repetido.product.name}".`);
      }
    }

    const unidade = await db.unit.findUnique({ where: { id: dados.unitId }, select: { name: true } });
    if (!unidade) throw new AppError('Unidade não encontrada', 404);

    const produto = await db.$transaction((tx) =>
      criarSeminovo(
        tx,
        {
          modelo: dados.modelo,
          marca: dados.marca,
          armazenamento: dados.armazenamento,
          cor: dados.cor,
          imei: dados.imei || null,
          batteryHealth: dados.batteryHealth ?? null,
          valorPago: dados.valorPago,
          salePrice: dados.salePrice,
          origem: dados.vendedor?.trim() ? `Comprado de ${dados.vendedor.trim()}` : 'Compra direta',
          notes: dados.observacoes,
        },
        dados.unitId,
        req.usuario!.id,
      ),
    );

    await registrarLog({
      acao: 'CRIAR_SEMINOVO',
      entidade: 'Product',
      id: produto.id,
      alteracoes: { nome: produto.name, pago: dados.valorPago },
      req,
    });

    res.status(201).json({
      ...limpar(produto),
      message: `${produto.name} cadastrado como seminovo na ${unidade.name}.`,
    });
  }),
);
