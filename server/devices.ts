import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth';
import {
  AppError,
  contem,
  limpar,
  naoEncontrado,
  paginacao,
  paginado,
  rota,
  semVazios,
  validar,
} from './core';
import { db, registrarLog } from './db';
import { exigir } from './permissoes';
import { sincronizarSaldoUnitario } from './estoque';
import { darEntradaDeAparelhos } from './produtos';
import { exigirAcessoNaUnidade, unidadePermitida } from './unidades';
import { imeiValido } from '../shared/trocas';

/** Aparelhos físicos (DeviceUnit) dos produtos controlados por unidade. */

export const rotasDevices = Router();
rotasDevices.use(autenticar, exigir('produtos.ver'));

const COM_RELACAO = {
  product: { select: { id: true, name: true, model: true, brand: true, tipoControle: true } },
  unit: { select: { id: true, name: true } },
  saleItem: { select: { id: true, sale: { select: { id: true, code: true, saleDate: true } } } },
} satisfies Prisma.DeviceUnitInclude;

const imeiSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || v.length === 15, 'O IMEI tem 15 números')
  .refine((v) => v === '' || imeiValido(v), 'Esse IMEI não passa na conferência (dígito verificador).')
  .optional()
  .nullable();

// -------------------------------------------------------------- Consulta

/** Busca por IMEI: diz se existe e em qual produto está. */
rotasDevices.get(
  '/por-imei/:imei',
  rota(async (req, res) => {
    const imei = String(req.params.imei ?? '').replace(/\D/g, '');
    if (imei.length < 6) {
      res.json({ encontrado: false });
      return;
    }

    const aparelho = await db.deviceUnit.findFirst({
      where: { OR: [{ imei }, { imei2: imei }, { serialNumber: imei }] },
      include: COM_RELACAO,
    });

    if (!aparelho) {
      res.json({ encontrado: false, imeiValido: imei.length === 15 ? imeiValido(imei) : null });
      return;
    }

    res.json({
      encontrado: true,
      device: limpar(aparelho),
      resumo:
        `${aparelho.product.name} · ${aparelho.status.toLowerCase()}` +
        (aparelho.unit ? ` na ${aparelho.unit.name}` : ''),
    });
  }),
);

rotasDevices.get(
  '/',
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
        productId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        status: z.enum(['EM_ESTOQUE', 'RESERVADO', 'EM_TRANSITO', 'VENDIDO', 'DEFEITO', 'DEVOLVIDO']).optional(),
        search: z.string().trim().optional(),
      }),
      semVazios(req.query),
    );

    const p = paginacao(q as Record<string, unknown>, 30);
    const unidade = unidadePermitida(req.usuario, q.unitId);

    const where: Prisma.DeviceUnitWhereInput = {
      ...(q.productId ? { productId: q.productId } : {}),
      ...(unidade ? { unitId: unidade } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { imei: contem(q.search) },
              { imei2: contem(q.search) },
              { serialNumber: contem(q.search) },
              { product: { name: contem(q.search) } },
            ],
          }
        : {}),
    };

    const [lista, total] = await Promise.all([
      db.deviceUnit.findMany({
        where,
        include: COM_RELACAO,
        skip: p.skip,
        take: p.take,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
      db.deviceUnit.count({ where }),
    ]);

    res.json(limpar(paginado(lista, total, p)));
  }),
);

rotasDevices.get(
  '/:id',
  rota(async (req, res) => {
    const aparelho = await db.deviceUnit.findUnique({
      where: { id: req.params.id },
      include: {
        ...COM_RELACAO,
        product: { select: { id: true, name: true, model: true, brand: true, tipoControle: true, salePrice: true } },
      },
    });
    if (!aparelho) throw naoEncontrado('Aparelho');

    const movimentos = await db.stockMovement.findMany({
      where: { deviceId: aparelho.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { name: true } }, unit: { select: { name: true } } },
    });

    res.json({ ...limpar(aparelho), movements: limpar(movimentos) });
  }),
);

// -------------------------------------------------------------- Entrada

const entradaSchema = z.object({
  productId: z.string().uuid('Selecione o produto'),
  unitId: z.string().uuid('Selecione a unidade'),
  aparelhos: z
    .array(
      z.object({
        imei: imeiSchema,
        imei2: imeiSchema,
        serialNumber: z.string().trim().max(60).optional().nullable(),
        condicao: z.string().trim().max(40).optional().nullable(),
        batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
        warrantyUntil: z.coerce.date().optional().nullable(),
        costPrice: z.coerce.number().min(0).optional(),
        salePrice: z.coerce.number().min(0).optional().nullable(),
        imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']).optional(),
        notes: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .min(1, 'Informe ao menos um aparelho')
    .max(50),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** Dá entrada de aparelhos num produto UNITARIO que já existe. */
rotasDevices.post(
  '/entrada',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const dados = validar(entradaSchema, req.body);
    exigirAcessoNaUnidade(req.usuario, dados.unitId);

    const produto = await db.product.findUnique({ where: { id: dados.productId } });
    if (!produto) throw naoEncontrado('Produto');
    if (produto.tipoControle !== 'UNITARIO') {
      throw new AppError('Este produto é controlado por quantidade. Use a entrada de mercadoria comum.');
    }

    // IMEI duplicado.
    const imeis = dados.aparelhos.map((a) => a.imei?.trim()).filter((v): v is string => Boolean(v));
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

    const resultado = await db.$transaction((tx) =>
      darEntradaDeAparelhos(
        tx,
        {
          id: produto.id,
          name: produto.name,
          costPrice: produto.costPrice,
          salePrice: produto.salePrice,
          garantiaPadraoDias: produto.garantiaPadraoDias,
        },
        dados.unitId,
        dados.aparelhos,
        { id: req.usuario?.id, nome: req.usuario?.nome },
        dados.notes?.trim() || `Entrada de ${dados.aparelhos.length} aparelho(s)`,
      ),
    );

    await registrarLog({
      acao: 'ENTRADA_APARELHOS',
      entidade: 'Product',
      id: produto.id,
      alteracoes: { quantidade: resultado.criados },
      req,
    });

    res.status(201).json({
      ...resultado,
      message: `${resultado.criados} aparelho(s) cadastrado(s). Custo médio: R$ ${resultado.medio.toFixed(2)}.`,
    });
  }),
);

// -------------------------------------------------------------- Edição

const edicaoSchema = z.object({
  imei: imeiSchema,
  imei2: imeiSchema,
  serialNumber: z.string().trim().max(60).optional().nullable(),
  condicao: z.string().trim().max(40).optional().nullable(),
  batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
  warrantyUntil: z.coerce.date().optional().nullable(),
  costPrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional().nullable(),
  imeiSituacao: z.enum(['NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO']).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

rotasDevices.put(
  '/:id',
  exigir('produtos.editar'),
  rota(async (req, res) => {
    const dados = validar(edicaoSchema, req.body);
    const aparelho = await db.deviceUnit.findUnique({ where: { id: req.params.id } });
    if (!aparelho) throw naoEncontrado('Aparelho');
    if (aparelho.status === 'VENDIDO') {
      throw new AppError('Aparelho já vendido: não dá para editar. Cancele a venda se algo está errado.');
    }

    const atualizado = await db.deviceUnit.update({
      where: { id: aparelho.id },
      data: {
        ...(dados.imei !== undefined ? { imei: dados.imei || null } : {}),
        ...(dados.imei2 !== undefined ? { imei2: dados.imei2 || null } : {}),
        ...(dados.serialNumber !== undefined ? { serialNumber: dados.serialNumber || null } : {}),
        ...(dados.condicao !== undefined ? { condicao: dados.condicao || null } : {}),
        ...(dados.batteryHealth !== undefined ? { batteryHealth: dados.batteryHealth } : {}),
        ...(dados.warrantyUntil !== undefined ? { warrantyUntil: dados.warrantyUntil } : {}),
        ...(dados.costPrice !== undefined ? { costPrice: new Prisma.Decimal(dados.costPrice) } : {}),
        ...(dados.salePrice !== undefined
          ? { salePrice: dados.salePrice != null ? new Prisma.Decimal(dados.salePrice) : null }
          : {}),
        ...(dados.imeiSituacao !== undefined
          ? {
              imeiSituacao: dados.imeiSituacao,
              imeiCheckedAt: dados.imeiSituacao === 'NAO_CONSULTADO' ? null : new Date(),
            }
          : {}),
        ...(dados.notes !== undefined ? { notes: dados.notes || null } : {}),
      },
      include: COM_RELACAO,
    });

    await registrarLog({ acao: 'UPDATE', entidade: 'DeviceUnit', id: aparelho.id, req });
    res.json(limpar(atualizado));
  }),
);

// ------------------------------------------------------- Baixa manual

const baixaSchema = z.object({
  motivo: z.enum(['DEFEITO', 'DEVOLUCAO_FORNECEDOR', 'PERDA', 'USO_INTERNO', 'OUTRO']),
  notes: z.string().trim().max(500).optional().nullable(),
});

const STATUS_POR_MOTIVO: Record<string, 'DEFEITO' | 'DEVOLVIDO'> = {
  DEFEITO: 'DEFEITO',
  DEVOLUCAO_FORNECEDOR: 'DEVOLVIDO',
  PERDA: 'DEVOLVIDO',
  USO_INTERNO: 'DEVOLVIDO',
  OUTRO: 'DEVOLVIDO',
};

/** Tira um aparelho do estoque sem ser por venda (defeito, perda, uso interno). */
rotasDevices.post(
  '/:id/baixa',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const { motivo, notes } = validar(baixaSchema, req.body);
    const aparelho = await db.deviceUnit.findUnique({ where: { id: req.params.id } });
    if (!aparelho) throw naoEncontrado('Aparelho');
    if (aparelho.status !== 'EM_ESTOQUE') {
      throw new AppError(`O aparelho está "${aparelho.status.toLowerCase()}" — não há o que baixar.`);
    }
    if (!aparelho.unitId) throw new AppError('O aparelho não está em nenhuma unidade.');
    exigirAcessoNaUnidade(req.usuario, aparelho.unitId);

    await db.$transaction(async (tx) => {
      await tx.deviceUnit.update({
        where: { id: aparelho.id },
        data: { status: STATUS_POR_MOTIVO[motivo] },
      });
      const antes = await tx.stock.findUnique({
        where: { productId_unitId: { productId: aparelho.productId, unitId: aparelho.unitId! } },
      });
      const depois = await sincronizarSaldoUnitario(aparelho.productId, aparelho.unitId!, tx);
      const prod = await tx.product.findUnique({ where: { id: aparelho.productId }, select: { name: true } });

      await tx.stockMovement.create({
        data: {
          type: 'SAIDA',
          reason: motivo === 'DEFEITO' ? 'DEFEITO' : motivo === 'DEVOLUCAO_FORNECEDOR' ? 'DEVOLUCAO_FORNECEDOR' : motivo === 'PERDA' ? 'PERDA' : motivo === 'USO_INTERNO' ? 'USO_INTERNO' : 'OUTRO',
          quantity: 1,
          previousQuantity: antes?.quantity ?? depois + 1,
          newQuantity: depois,
          deviceId: aparelho.id,
          productId: aparelho.productId,
          productName: prod?.name ?? 'Produto',
          unitId: aparelho.unitId,
          userId: req.usuario?.id ?? null,
          notes: notes?.trim() || null,
        },
      });
    });

    await registrarLog({ acao: 'BAIXA_APARELHO', entidade: 'DeviceUnit', id: aparelho.id, alteracoes: { motivo }, req });
    res.json({ message: 'Aparelho baixado do estoque.' });
  }),
);

/** Volta um aparelho baixado (defeito resolvido, devolução cancelada) para o estoque. */
rotasDevices.post(
  '/:id/retornar',
  exigir('estoque.movimentar'),
  rota(async (req, res) => {
    const aparelho = await db.deviceUnit.findUnique({ where: { id: req.params.id } });
    if (!aparelho) throw naoEncontrado('Aparelho');
    if (aparelho.status === 'EM_ESTOQUE') throw new AppError('O aparelho já está em estoque.');
    if (aparelho.status === 'VENDIDO') throw new AppError('Aparelho vendido: cancele a venda para devolvê-lo.');

    const unidade = aparelho.unitId ?? req.usuario?.unidadeId;
    if (!unidade) throw new AppError('Escolha a unidade onde o aparelho volta.');
    exigirAcessoNaUnidade(req.usuario, unidade);

    await db.$transaction(async (tx) => {
      await tx.deviceUnit.update({
        where: { id: aparelho.id },
        data: { status: 'EM_ESTOQUE', unitId: unidade },
      });
      const depois = await sincronizarSaldoUnitario(aparelho.productId, unidade, tx);
      const prod = await tx.product.findUnique({ where: { id: aparelho.productId }, select: { name: true } });
      await tx.stockMovement.create({
        data: {
          type: 'ENTRADA', reason: 'AJUSTE', quantity: 1,
          previousQuantity: Math.max(0, depois - 1), newQuantity: depois,
          deviceId: aparelho.id, productId: aparelho.productId, productName: prod?.name ?? 'Produto',
          unitId: unidade, userId: req.usuario?.id ?? null, notes: 'Aparelho retornou ao estoque',
        },
      });
    });

    await registrarLog({ acao: 'RETORNO_APARELHO', entidade: 'DeviceUnit', id: aparelho.id, req });
    res.json({ message: 'Aparelho de volta ao estoque.' });
  }),
);

rotasDevices.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const aparelho = await db.deviceUnit.findUnique({ where: { id: req.params.id } });
    if (!aparelho) throw naoEncontrado('Aparelho');
    if (aparelho.status === 'VENDIDO') {
      throw new AppError('Aparelho vendido faz parte do histórico e não pode ser excluído.');
    }

    await db.deviceUnit.delete({ where: { id: aparelho.id } });
    if (aparelho.unitId) {
      await db.$transaction((tx) => sincronizarSaldoUnitario(aparelho.productId, aparelho.unitId!, tx));
    }
    await registrarLog({ acao: 'DELETE', entidade: 'DeviceUnit', id: aparelho.id, req });
    res.json({ message: 'Aparelho excluído.' });
  }),
);
