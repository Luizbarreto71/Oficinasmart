import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth.js';
import { limpar, paginacao, paginado, rota, semVazios, validar } from './core.js';
import { db } from './db.js';

/**
 * Avisos na tela: o caixa sabe que chegou pré-venda, o vendedor sabe que
 * a dele foi finalizada ou cancelada. Nunca lança.
 */

interface Aviso {
  userId: string;
  title: string;
  message: string;
  link?: string;
}

export async function notificar(aviso: Aviso): Promise<void> {
  try {
    await db.notification.create({ data: aviso });
  } catch (erro) {
    console.error('[notificação]', (erro as Error).message);
  }
}

/** Avisa todo mundo de um perfil — usado quando chega pré-venda para o caixa. */
export async function notificarPerfil(
  papel: 'ADMIN' | 'CAIXA' | 'GERENTE' | 'VENDEDOR',
  aviso: Omit<Aviso, 'userId'>,
): Promise<void> {
  try {
    const pessoas = await db.user.findMany({
      where: { role: papel, active: true },
      select: { id: true },
    });

    if (!pessoas.length) return;

    await db.notification.createMany({
      data: pessoas.map((p) => ({ ...aviso, userId: p.id })),
    });
  } catch (erro) {
    console.error('[notificação]', (erro as Error).message);
  }
}

export const rotasNotificacoes = Router();
rotasNotificacoes.use(autenticar);

rotasNotificacoes.get(
  '/',
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        naoLidas: z.enum(['true', 'false']).optional(),
      }),
      semVazios(req.query),
    );

    const p = paginacao(q as Record<string, unknown>, 20);
    const where = {
      userId: req.usuario!.id,
      ...(q.naoLidas === 'true' ? { read: false } : {}),
    };

    const [lista, total, naoLidas] = await Promise.all([
      db.notification.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' } }),
      db.notification.count({ where }),
      db.notification.count({ where: { userId: req.usuario!.id, read: false } }),
    ]);

    res.json(limpar({ ...paginado(lista, total, p), unread: naoLidas }));
  }),
);

rotasNotificacoes.post(
  '/ler',
  rota(async (req, res) => {
    const { id } = validar(z.object({ id: z.string().uuid().optional() }), req.body ?? {});

    await db.notification.updateMany({
      where: { userId: req.usuario!.id, ...(id ? { id } : { read: false }) },
      data: { read: true },
    });

    res.json({ message: 'Avisos marcados como lidos' });
  }),
);
