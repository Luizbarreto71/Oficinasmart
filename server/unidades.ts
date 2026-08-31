import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth';
import { AppError, limpar, naoEncontrado, rota, validar } from './core';
import { db, registrarLog } from './db';

/** Cadastro das unidades (Loja, Estoque…) e o filtro de acesso por unidade. */

export const rotasUnidades = Router();
rotasUnidades.use(autenticar);

const unidadeSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da unidade').max(80),
  type: z.enum(['MATRIZ', 'FILIAL']).default('FILIAL'),
  active: z.boolean().optional(),
});

/**
 * Resolve qual unidade a requisição pode enxergar.
 *
 * - Administrador: qualquer uma, ou todas se não escolher.
 * - Gerente e Vendedor: sempre a sua, ignorando o que vier no filtro.
 *
 * Devolver `undefined` significa "todas as unidades".
 */
export function unidadePermitida(
  usuario: Express.Request['usuario'],
  pedida?: string,
): string | undefined {
  if (!usuario) return undefined;
  if (usuario.admin) return pedida || undefined;
  return usuario.unidadeId ?? '00000000-0000-0000-0000-000000000000';
}

/** Impede operar numa unidade que não é a sua. */
export function exigirAcessoNaUnidade(
  usuario: Express.Request['usuario'],
  unidadeId: string,
): void {
  if (!usuario) throw new AppError('Não autorizado', 401);
  if (usuario.admin) return;
  if (usuario.unidadeId !== unidadeId) {
    throw new AppError('Você só pode movimentar o estoque da sua unidade.', 403);
  }
}

rotasUnidades.get(
  '/',
  rota(async (req, res) => {
    const unidades = await db.unit.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { stock: true, sales: true } } },
    });

    const visiveis = req.usuario?.admin
      ? unidades
      : unidades.filter((u) => u.id === req.usuario?.unidadeId);

    res.json(limpar(visiveis));
  }),
);

rotasUnidades.post(
  '/',
  somenteAdmin,
  rota(async (req, res) => {
    const unidade = await db.unit.create({ data: validar(unidadeSchema, req.body) });
    await registrarLog({ acao: 'CREATE', entidade: 'Unit', id: unidade.id, req });
    res.status(201).json(limpar(unidade));
  }),
);

rotasUnidades.put(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const unidade = await db.unit.update({
      where: { id: req.params.id },
      data: validar(unidadeSchema.partial(), req.body),
    });
    await registrarLog({ acao: 'UPDATE', entidade: 'Unit', id: unidade.id, req });
    res.json(limpar(unidade));
  }),
);

rotasUnidades.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const unidade = await db.unit.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { stock: true, sales: true, movements: true } } },
    });
    if (!unidade) throw naoEncontrado('Unidade');

    const temHistorico =
      unidade._count.stock > 0 || unidade._count.sales > 0 || unidade._count.movements > 0;

    if (temHistorico) {
      await db.unit.update({ where: { id: unidade.id }, data: { active: false } });
      await registrarLog({ acao: 'DEACTIVATE', entidade: 'Unit', id: unidade.id, req });
      res.json({
        message: `A ${unidade.name} tem movimentações registradas e foi desativada em vez de excluída.`,
        deactivated: true,
      });
      return;
    }

    await db.unit.delete({ where: { id: unidade.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'Unit', id: unidade.id, req });
    res.json({ message: 'Unidade excluída com sucesso', deactivated: false });
  }),
);
