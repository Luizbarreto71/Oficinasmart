import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth.js';
import {
  AppError,
  limpar,
  naoEncontrado,
  paginacao,
  paginado,
  rota,
  semVazios,
  validar,
} from './core.js';
import { db, registrarLog } from './db.js';
import { notificarPerfil } from './notificacoes.js';
import { exigir, podeFazer } from './permissoes.js';
import { proximoCodigo } from './vendas-service.js';
import { DEFEITOS, imeiValido } from '../shared/trocas.js';

export const rotasTrocas = Router();
rotasTrocas.use(autenticar);

const CHAVES_DEFEITO = DEFEITOS.map((d) => d.chave) as [string, ...string[]];

const COM_TUDO = {
  aparelhos: {
    orderBy: { ordem: 'asc' } as const,
    include: { fotos: { select: { id: true, tipo: true }, orderBy: { createdAt: 'asc' } as const } },
  },
  photos: { select: { id: true, tipo: true }, orderBy: { createdAt: 'asc' } as const },
  seller: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  product: { select: { id: true, name: true } },
  preSale: { select: { id: true, code: true, status: true } },
  sale: { select: { id: true, code: true } },
} satisfies Prisma.TradeInInclude;

const paraJson = (t: Prisma.TradeInGetPayload<{ include: typeof COM_TUDO }>) => ({
  ...limpar(t),
  photos: t.photos.map((f) => ({ id: f.id, tipo: f.tipo, url: `/api/trocas/fotos/${f.id}` })),
  aparelhos: t.aparelhos.map((a) => ({
    ...limpar(a),
    fotos: a.fotos.map((f) => ({ id: f.id, tipo: f.tipo, url: `/api/trocas/fotos/${f.id}` })),
  })),
  diferenca: Number(t.valorSaida) - Number(t.valorAvaliado),
});

const fotoSchema = z.object({
  tipo: z.enum(['ANATEL', 'DOCUMENTO', 'APARELHO']),
  data: z.string().max(4_000_000),
});

const imeiSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || v.length === 15, 'O IMEI tem 15 números')
  .refine((v) => v === '' || imeiValido(v), 'Esse IMEI não passa na conferência — confira os números')
  .optional()
  .nullable();

const aparelhoSchema = z.object({
  modelo: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120),
  marca: z.string().trim().max(60).optional().nullable(),
  armazenamento: z.string().trim().max(20).optional().nullable(),
  cor: z.string().trim().max(40).optional().nullable(),
  imei: imeiSchema,
  imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']).default('NAO_CONSULTADO'),
  estado: z.string().trim().max(40).optional().nullable(),
  defeitos: z.array(z.enum(CHAVES_DEFEITO)).default([]),
  observacoes: z.string().trim().max(2000).optional().nullable(),
  valorAvaliado: z.coerce.number().min(0, 'Informe quanto vale o aparelho do cliente'),
  photos: z.array(fotoSchema).max(8).optional(),
});

const trocaSchema = z.object({
  aparelhos: z.array(aparelhoSchema).min(1).max(6).optional(),

  modelo: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120).optional(),
  marca: z.string().trim().max(60).optional().nullable(),
  armazenamento: z.string().trim().max(20).optional().nullable(),
  cor: z.string().trim().max(40).optional().nullable(),
  imei: imeiSchema,
  imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']).default('NAO_CONSULTADO'),

  estado: z.string().trim().max(40).optional().nullable(),
  defeitos: z.array(z.enum(CHAVES_DEFEITO)).default([]),
  observacoes: z.string().trim().max(2000).optional().nullable(),

  valorAvaliado: z.coerce.number().min(0).optional(),

  productId: z.string().uuid().optional().nullable(),
  saidaNome: z.string().trim().max(180).optional().nullable(),
  valorSaida: z.coerce.number().min(0).default(0),

  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().min(2, 'Informe o nome do cliente').max(180),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),

  unitId: z.string().uuid().optional().nullable(),
  photos: z.array(fotoSchema).max(10).optional(),
});

const podeVerTodas = (req: { usuario?: { papel: string } }) =>
  podeFazer(req.usuario?.papel, 'prevenda.verTodas');

function aparelhosDaTroca(dados: z.infer<typeof trocaSchema>): z.infer<typeof aparelhoSchema>[] {
  if (dados.aparelhos?.length) return dados.aparelhos;

  if (!dados.modelo) {
    throw new AppError('Informe ao menos um aparelho na troca.');
  }

  return [
    {
      modelo: dados.modelo,
      marca: dados.marca,
      armazenamento: dados.armazenamento,
      cor: dados.cor,
      imei: dados.imei,
      imeiSituacao: dados.imeiSituacao,
      estado: dados.estado,
      defeitos: dados.defeitos,
      observacoes: dados.observacoes,
      valorAvaliado: dados.valorAvaliado ?? 0,
      photos: undefined,
    },
  ];
}

const resumoDosAparelhos = (aparelhos: { modelo: string }[]): string =>
  aparelhos.length === 1
    ? aparelhos[0].modelo
    : `${aparelhos[0].modelo} + ${aparelhos.length - 1} aparelho${aparelhos.length > 2 ? 's' : ''}`;

function separarFotos(fotos: z.infer<typeof fotoSchema>[] | undefined) {
  return (fotos ?? []).flatMap((f) => {
    const base64 = f.data.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!base64) return [];
    return [{ tipo: f.tipo, mimeType: base64[1], data: Buffer.from(base64[2], 'base64') }];
  });
}

// ---------------------------------------------------------------- Listagem

rotasTrocas.get(
  '/',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        status: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
          .pipe(z.array(z.enum(['AVALIADA', 'ACEITA', 'RECUSADA'])).min(1).optional()),
        search: z.string().trim().optional(),
        livres: z.enum(['true', 'false']).optional(),
      }),
      semVazios(req.query),
    );

    const p = paginacao(q as Record<string, unknown>);

    const where: Prisma.TradeInWhereInput = {
      ...(podeVerTodas(req) ? {} : { sellerId: req.usuario!.id }),
      ...(q.status ? { status: { in: q.status } } : {}),
      ...(q.livres === 'true' ? { preSaleId: null, saleId: null, status: 'AVALIADA' } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { imei: { contains: q.search } },
              { modelo: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [lista, total] = await Promise.all([
      db.tradeIn.findMany({ where, include: COM_TUDO, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' } }),
      db.tradeIn.count({ where }),
    ]);

    res.json(paginado(lista.map(paraJson), total, p));
  }),
);

rotasTrocas.get(
  '/:id',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const troca = await db.tradeIn.findUnique({ where: { id: req.params.id }, include: COM_TUDO });
    if (!troca) throw naoEncontrado('Troca');

    if (!podeVerTodas(req) && troca.sellerId !== req.usuario!.id) {
      throw new AppError('Esta troca é de outro vendedor', 403);
    }

    res.json(paraJson(troca));
  }),
);

rotasTrocas.get(
  '/fotos/:id',
  rota(async (req, res) => {
    const foto = await db.tradeInPhoto.findUnique({ where: { id: req.params.id } });
    if (!foto) throw naoEncontrado('Foto');

    res.setHeader('Content-Type', foto.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(Buffer.from(foto.data));
  }),
);

// ------------------------------------------------------------------ Criação

rotasTrocas.post(
  '/',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const dados = validar(trocaSchema, req.body);
    const aparelhos = aparelhosDaTroca(dados);

    const repetidosAqui = aparelhos
      .map((a) => a.imei)
      .filter((imei, i, todos): imei is string => Boolean(imei) && todos.indexOf(imei) !== i);
    if (repetidosAqui.length) {
      throw new AppError(`O IMEI ${repetidosAqui[0]} foi informado duas vezes nesta troca.`);
    }

    for (const aparelho of aparelhos) {
      if (aparelho.imei) {
        const [naTroca, noAparelho] = await Promise.all([
          db.tradeIn.findFirst({
            where: { imei: aparelho.imei, status: { not: 'RECUSADA' } },
            select: { code: true },
          }),
          db.tradeInAparelho.findFirst({
            where: { imei: aparelho.imei, tradeIn: { status: { not: 'RECUSADA' } } },
            select: { tradeIn: { select: { code: true } } },
          }),
        ]);

        const repetido = naTroca?.code ?? noAparelho?.tradeIn.code;
        if (repetido) {
          throw new AppError(
            `Esse IMEI já foi recebido na troca ${repetido}. Se for outro aparelho, confira os números.`,
          );
        }
      }

      if (aparelho.imeiSituacao === 'BLOQUEADO') {
        throw new AppError(
          `A Anatel aponta o ${aparelho.modelo} como roubado, furtado ou bloqueado. Não é possível recebê-lo.`,
        );
      }
    }

    const avaliacao = aparelhos.reduce((soma, a) => soma + a.valorAvaliado, 0);

    let saidaNome = dados.saidaNome ?? null;
    if (dados.productId) {
      const produto = await db.product.findUnique({ where: { id: dados.productId }, select: { name: true } });
      if (!produto) throw naoEncontrado('Produto');
      saidaNome = produto.name;
    }

    const troca = await db.tradeIn.create({
      data: {
        code: await proximoCodigo('troca', 'TR'),
        sellerId: req.usuario!.id,
        unitId: dados.unitId ?? req.usuario!.unidadeId ?? null,

        modelo: resumoDosAparelhos(aparelhos),
        marca: aparelhos.length === 1 ? (aparelhos[0].marca ?? null) : null,
        armazenamento: aparelhos.length === 1 ? (aparelhos[0].armazenamento ?? null) : null,
        cor: aparelhos.length === 1 ? (aparelhos[0].cor ?? null) : null,
        imei: aparelhos.length === 1 ? aparelhos[0].imei || null : null,
        imeiSituacao: aparelhos.length === 1 ? aparelhos[0].imeiSituacao : 'NAO_CONSULTADO',
        imeiCheckedAt:
          aparelhos.length === 1 && aparelhos[0].imeiSituacao !== 'NAO_CONSULTADO' ? new Date() : null,

        estado: aparelhos.length === 1 ? (aparelhos[0].estado ?? null) : null,
        defeitos: aparelhos.length === 1 ? aparelhos[0].defeitos : [],
        observacoes: dados.observacoes ?? (aparelhos.length === 1 ? (aparelhos[0].observacoes ?? null) : null),

        valorAvaliado: new Prisma.Decimal(avaliacao),
        productId: dados.productId ?? null,
        saidaNome,
        valorSaida: new Prisma.Decimal(dados.valorSaida),

        customerId: dados.customerId ?? null,
        customerName: dados.customerName,
        customerPhone: dados.customerPhone ?? null,
        customerDocument: dados.customerDocument ?? null,

        aparelhos: {
          create: aparelhos.map((a, i) => ({
            ordem: i,
            modelo: a.modelo,
            marca: a.marca ?? null,
            armazenamento: a.armazenamento ?? null,
            cor: a.cor ?? null,
            imei: a.imei || null,
            imeiSituacao: a.imeiSituacao,
            imeiCheckedAt: a.imeiSituacao === 'NAO_CONSULTADO' ? null : new Date(),
            estado: a.estado ?? null,
            defeitos: a.defeitos,
            observacoes: a.observacoes ?? null,
            valorAvaliado: new Prisma.Decimal(a.valorAvaliado),
          })),
        },

        photos: { create: separarFotos(dados.photos) },
      },
      include: COM_TUDO,
    });

    const comFoto = aparelhos.flatMap((a, i) => {
      const fotos = separarFotos(a.photos);
      if (!fotos.length) return [];
      const criado = troca.aparelhos.find((x) => x.ordem === i);
      return criado ? fotos.map((f) => ({ ...f, tradeInId: troca.id, aparelhoId: criado.id })) : [];
    });
    if (comFoto.length) await db.tradeInPhoto.createMany({ data: comFoto });

    await registrarLog({
      acao: 'CRIAR_TROCA',
      entidade: 'TradeIn',
      id: troca.id,
      alteracoes: { codigo: troca.code, aparelhos: aparelhos.length, valor: avaliacao },
      req,
    });

    res.status(201).json({
      ...paraJson(troca),
      message:
        aparelhos.length === 1
          ? `Troca ${troca.code} registrada — ${aparelhos[0].modelo} avaliado em R$ ${avaliacao.toFixed(2)}.`
          : `Troca ${troca.code} registrada — ${aparelhos.length} aparelhos avaliados em R$ ${avaliacao.toFixed(2)}.`,
    });
  }),
);

// ------------------------------------------------------------ Ajustes

const situacaoSchema = z.object({
  imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']),
  foto: z.string().max(4_000_000).optional().nullable(),
});

rotasTrocas.post(
  '/:id/anatel',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const { imeiSituacao, foto } = validar(situacaoSchema, req.body);

    const troca = await db.tradeIn.findUnique({ where: { id: req.params.id } });
    if (!troca) throw naoEncontrado('Troca');
    if (!podeVerTodas(req) && troca.sellerId !== req.usuario!.id) {
      throw new AppError('Esta troca é de outro vendedor', 403);
    }

    const novas = separarFotos(foto ? [{ tipo: 'ANATEL', data: foto }] : []);

    const atualizada = await db.tradeIn.update({
      where: { id: troca.id },
      data: {
        imeiSituacao,
        imeiCheckedAt: imeiSituacao === 'NAO_CONSULTADO' ? null : new Date(),
        photos: novas.length ? { create: novas } : undefined,
      },
      include: COM_TUDO,
    });

    if (imeiSituacao === 'BLOQUEADO') {
      await notificarPerfil('ADMIN', {
        title: `IMEI bloqueado na troca ${troca.code}`,
        message: `${troca.modelo} · IMEI ${troca.imei} · cliente ${troca.customerName}`,
        link: '/trocas',
      });
    }

    await registrarLog({ acao: 'ANATEL_TROCA', entidade: 'TradeIn', id: troca.id, req });
    res.json(paraJson(atualizada));
  }),
);

rotasTrocas.post(
  '/:id/recusar',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const troca = await db.tradeIn.findUnique({ where: { id: req.params.id } });
    if (!troca) throw naoEncontrado('Troca');
    if (troca.status === 'ACEITA') throw new AppError('Esta troca já virou venda.');
    if (!podeVerTodas(req) && troca.sellerId !== req.usuario!.id) {
      throw new AppError('Esta troca é de outro vendedor', 403);
    }

    await db.tradeIn.update({
      where: { id: troca.id },
      data: { status: 'RECUSADA', preSaleId: null },
    });

    await registrarLog({ acao: 'RECUSAR_TROCA', entidade: 'TradeIn', id: troca.id, req });
    res.json({ message: `Troca ${troca.code} recusada — o aparelho volta para o cliente.` });
  }),
);

rotasTrocas.delete(
  '/:id',
  exigir('troca.criar'),
  rota(async (req, res) => {
    const troca = await db.tradeIn.findUnique({ where: { id: req.params.id } });
    if (!troca) throw naoEncontrado('Troca');
    if (troca.status === 'ACEITA') throw new AppError('Esta troca já virou venda e faz parte do histórico.');
    if (!podeVerTodas(req) && troca.sellerId !== req.usuario!.id) {
      throw new AppError('Esta troca é de outro vendedor', 403);
    }

    await db.tradeIn.delete({ where: { id: troca.id } });
    await registrarLog({ acao: 'EXCLUIR_TROCA', entidade: 'TradeIn', id: troca.id, req });
    res.json({ message: `Troca ${troca.code} excluída.` });
  }),
);
