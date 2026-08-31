import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, somenteAdmin } from './auth';
import { AppError, contem, limpar, naoEncontrado, paginacao, paginado, rota, validar, semVazios } from './core';
import { db, registrarLog } from './db';
import { proximaCor } from '../shared/cores';
import { camposParaJson, normalizarCampos, PADRAO_GENERICO, PADROES } from '../shared/campos';

/** Categorias, fornecedores, clientes, usuários e o log de auditoria. */

// ------------------------------------------------------------------- Campos

const texto = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => v || null);

const email = z
  .string()
  .trim()
  .email('E-mail inválido')
  .or(z.literal(''))
  .optional()
  .nullable()
  .transform((v) => v || null);

const buscaSimples = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  all: z.enum(['true', 'false']).optional(),
});

// --------------------------------------------------------------- Categorias

export const rotasCategorias = Router();

async function conferirMae(parentId: string | null | undefined) {
  if (!parentId) return;

  const mae = await db.category.findUnique({ where: { id: parentId } });
  if (!mae) throw naoEncontrado('Categoria');
  if (mae.parentId) {
    throw new AppError(`${mae.name} já é uma subcategoria. Só há um nível de subcategoria.`);
  }
}
rotasCategorias.use(autenticar);

const apelido = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const categoriaSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da categoria').max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
    .optional()
    .nullable(),
  campos: z
    .array(
      z.object({
        campo: z.string(),
        rotulo: z.string().trim().max(60).optional(),
        obrigatorio: z.boolean().optional(),
      }),
    )
    .optional(),
  tipoControlePadrao: z.enum(['UNITARIO', 'QUANTIDADE']).optional(),
  parentId: z.string().uuid().optional().nullable(),
  ordem: z.coerce.number().int().min(0).max(999).optional(),
});

rotasCategorias.get(
  '/',
  rota(async (_req, res) => {
    const categorias = await db.category.findMany({
      orderBy: [{ ordem: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } }, parent: { select: { id: true, name: true } } },
    });

    const mães = categorias.filter((c) => !c.parentId);
    const emOrdem = mães.flatMap((mae) => [
      mae,
      ...categorias.filter((c) => c.parentId === mae.id),
    ]);

    const soltas = categorias.filter((c) => !emOrdem.includes(c));

    res.json(
      limpar(
        [...emOrdem, ...soltas].map((c) => {
          const mae = c.parentId ? categorias.find((x) => x.id === c.parentId) : null;
          return {
            ...c,
            campos: normalizarCampos(c.campos ?? mae?.campos ?? null, mae?.slug ?? c.slug),
            caminho: mae ? `${mae.name} › ${c.name}` : c.name,
            ehSubcategoria: Boolean(c.parentId),
          };
        }),
      ),
    );
  }),
);

rotasCategorias.post(
  '/',
  somenteAdmin,
  rota(async (req, res) => {
    const dados = validar(categoriaSchema, req.body);
    await conferirMae(dados.parentId);
    const slug = apelido(dados.name);

    const cor = dados.color ?? proximaCor((await db.category.findMany({ select: { color: true } })).map((c) => c.color));
    const categoria = await db.category.create({
      data: {
        ...dados,
        slug,
        color: cor,
        campos: camposParaJson(normalizarCampos(dados.campos ?? PADROES[slug] ?? PADRAO_GENERICO, slug)),
      },
    });
    await registrarLog({ acao: 'CREATE', entidade: 'Category', id: categoria.id, req });
    res.status(201).json(limpar(categoria));
  }),
);

rotasCategorias.put(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const dados = validar(categoriaSchema.partial(), req.body);
    const atual = await db.category.findUnique({ where: { id: req.params.id } });
    if (!atual) throw naoEncontrado('Categoria');

    if (dados.parentId !== undefined) {
      if (dados.parentId === req.params.id) {
        throw new AppError('Uma categoria não pode ser subcategoria dela mesma.');
      }
      await conferirMae(dados.parentId);

      const temFilhas = await db.category.count({ where: { parentId: req.params.id } });
      if (dados.parentId && temFilhas > 0) {
        throw new AppError(
          `Esta categoria tem ${temFilhas} subcategoria(s). Mova-as antes de torná-la subcategoria.`,
        );
      }
    }

    const categoria = await db.category.update({
      where: { id: req.params.id },
      data: {
        ...dados,
        ...(dados.name ? { slug: apelido(dados.name) } : {}),
        ...(dados.campos ? { campos: camposParaJson(normalizarCampos(dados.campos, atual.slug)) } : {}),
      },
    });
    await registrarLog({ acao: 'UPDATE', entidade: 'Category', id: categoria.id, req });
    res.json(limpar(categoria));
  }),
);

rotasCategorias.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const filhas = await db.category.count({ where: { parentId: req.params.id } });
    if (filhas > 0) {
      throw new AppError(
        `Esta categoria tem ${filhas} subcategoria(s). Exclua ou mova as subcategorias primeiro.`,
        409,
      );
    }

    const usados = await db.product.count({ where: { categoryId: req.params.id } });
    if (usados > 0) {
      throw new AppError(
        `Esta categoria tem ${usados} produto(s). Mova-os para outra categoria antes de excluir.`,
        409,
      );
    }
    await db.category.delete({ where: { id: req.params.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'Category', id: req.params.id, req });
    res.json({ message: 'Categoria excluída com sucesso' });
  }),
);

// ------------------------------------------------------------- Fornecedores

export const rotasFornecedores = Router();
rotasFornecedores.use(autenticar);

const fornecedorSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do fornecedor').max(180),
  phone: texto,
  email,
  document: texto,
  address: texto,
  notes: texto,
  active: z.boolean().optional(),
});

rotasFornecedores.get(
  '/',
  rota(async (req, res) => {
    const q = validar(buscaSimples, semVazios(req.query));
    const where = q.search
      ? { OR: [{ name: contem(q.search) }, { phone: contem(q.search) }, { email: contem(q.search) }] }
      : {};

    if (q.all === 'true') {
      const lista = await db.supplier.findMany({ where, orderBy: { name: 'asc' } });
      res.json(
        limpar({ data: lista, meta: { page: 1, pageSize: lista.length, total: lista.length, totalPages: 1 } }),
      );
      return;
    }

    const p = paginacao(q as Record<string, unknown>);
    const [lista, total] = await Promise.all([
      db.supplier.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
      db.supplier.count({ where }),
    ]);

    res.json(limpar(paginado(lista, total, p)));
  }),
);

rotasFornecedores.post(
  '/',
  rota(async (req, res) => {
    const fornecedor = await db.supplier.create({ data: validar(fornecedorSchema, req.body) });
    await registrarLog({ acao: 'CREATE', entidade: 'Supplier', id: fornecedor.id, req });
    res.status(201).json(limpar(fornecedor));
  }),
);

rotasFornecedores.put(
  '/:id',
  rota(async (req, res) => {
    const fornecedor = await db.supplier.update({
      where: { id: req.params.id },
      data: validar(fornecedorSchema.partial(), req.body),
    });
    await registrarLog({ acao: 'UPDATE', entidade: 'Supplier', id: fornecedor.id, req });
    res.json(limpar(fornecedor));
  }),
);

rotasFornecedores.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    const vinculados = await db.product.count({ where: { supplierId: req.params.id } });

    if (vinculados > 0) {
      await db.supplier.update({ where: { id: req.params.id }, data: { active: false } });
      await registrarLog({ acao: 'DEACTIVATE', entidade: 'Supplier', id: req.params.id, req });
      res.json({
        message: `Fornecedor tem ${vinculados} produto(s) e foi desativado em vez de excluído.`,
        deactivated: true,
      });
      return;
    }

    await db.supplier.delete({ where: { id: req.params.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'Supplier', id: req.params.id, req });
    res.json({ message: 'Fornecedor excluído com sucesso', deactivated: false });
  }),
);

// ----------------------------------------------------------------- Clientes

export const rotasClientes = Router();
rotasClientes.use(autenticar);

const clienteSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente').max(180),
  phone: texto,
  email,
  document: texto,
  notes: texto,
});

rotasClientes.get(
  '/',
  rota(async (req, res) => {
    const q = validar(buscaSimples, semVazios(req.query));
    const p = paginacao(q as Record<string, unknown>);

    const where = q.search
      ? { OR: [{ name: contem(q.search) }, { phone: contem(q.search) }, { email: contem(q.search) }] }
      : {};

    if (q.all === 'true') {
      const lista = await db.customer.findMany({ where, orderBy: { name: 'asc' }, take: 500 });
      res.json(
        limpar({ data: lista, meta: { page: 1, pageSize: lista.length, total: lista.length, totalPages: 1 } }),
      );
      return;
    }

    const [lista, total] = await Promise.all([
      db.customer.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { sales: true } } },
      }),
      db.customer.count({ where }),
    ]);

    res.json(limpar(paginado(lista, total, p)));
  }),
);

rotasClientes.get(
  '/:id',
  rota(async (req, res) => {
    const cliente = await db.customer.findUnique({
      where: { id: req.params.id },
      include: {
        sales: {
          orderBy: { saleDate: 'desc' },
          take: 20,
          include: { items: { select: { productName: true, quantity: true } } },
        },
      },
    });
    if (!cliente) throw naoEncontrado('Cliente');
    res.json(limpar(cliente));
  }),
);

rotasClientes.post(
  '/',
  rota(async (req, res) => {
    const cliente = await db.customer.create({ data: validar(clienteSchema, req.body) });
    await registrarLog({ acao: 'CREATE', entidade: 'Customer', id: cliente.id, req });
    res.status(201).json(limpar(cliente));
  }),
);

rotasClientes.put(
  '/:id',
  rota(async (req, res) => {
    const cliente = await db.customer.update({
      where: { id: req.params.id },
      data: validar(clienteSchema.partial(), req.body),
    });
    await registrarLog({ acao: 'UPDATE', entidade: 'Customer', id: cliente.id, req });
    res.json(limpar(cliente));
  }),
);

rotasClientes.delete(
  '/:id',
  somenteAdmin,
  rota(async (req, res) => {
    await db.customer.delete({ where: { id: req.params.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'Customer', id: req.params.id, req });
    res.json({ message: 'Cliente excluído com sucesso' });
  }),
);

// ----------------------------------------------------------------- Usuários

export const rotasUsuarios = Router();
rotasUsuarios.use(autenticar, somenteAdmin);

const campos = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  unitId: true,
  unit: { select: { id: true, name: true } },
  fotoMimeType: true,
};

const comFoto = <T extends { id: string; fotoMimeType?: string | null; updatedAt?: Date }>(u: T) => {
  const { fotoMimeType, ...resto } = u;
  return { ...resto, foto: fotoMimeType ? `/api/fotos/usuario/${u.id}?v=${u.updatedAt?.getTime() ?? 0}` : null };
};

const usuarioSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().trim().min(6, 'A senha deve ter ao menos 6 caracteres'),
  role: z.enum(['ADMIN', 'GERENTE', 'CAIXA', 'VENDEDOR']).default('VENDEDOR'),
  unitId: z.string().uuid().optional().nullable(),
  active: z.boolean().default(true),
});

const alterarUsuarioSchema = usuarioSchema.partial().extend({
  password: z.string().trim().min(6, 'A senha deve ter ao menos 6 caracteres').or(z.literal('')).optional(),
});

async function garantirOutroAdmin(): Promise<void> {
  const admins = await db.user.count({ where: { role: 'ADMIN', active: true } });
  if (admins <= 1) throw new AppError('É necessário manter ao menos um administrador ativo', 409);
}

rotasUsuarios.get(
  '/',
  rota(async (req, res) => {
    const p = paginacao(req.query as Record<string, unknown>, 50);
    const [lista, total] = await Promise.all([
      db.user.findMany({ select: campos, skip: p.skip, take: p.take, orderBy: { createdAt: 'asc' } }),
      db.user.count(),
    ]);
    res.json(paginado(lista.map(comFoto), total, p));
  }),
);

rotasUsuarios.get(
  '/logs/activity',
  rota(async (req, res) => {
    const p = paginacao(req.query as Record<string, unknown>, 30);
    const [lista, total] = await Promise.all([
      db.auditLog.findMany({
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      db.auditLog.count(),
    ]);
    res.json(limpar(paginado(lista, total, p)));
  }),
);

rotasUsuarios.post(
  '/',
  rota(async (req, res) => {
    const dados = validar(usuarioSchema, req.body);
    const usuario = await db.user.create({
      data: { ...dados, password: await bcrypt.hash(dados.password, 10) },
      select: campos,
    });
    await registrarLog({ acao: 'CREATE', entidade: 'User', id: usuario.id, req });
    res.status(201).json(comFoto(usuario));
  }),
);

rotasUsuarios.put(
  '/:id',
  rota(async (req, res) => {
    const dados = validar(alterarUsuarioSchema, req.body);

    const alvo = await db.user.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw naoEncontrado('Usuário');

    if (alvo.role === 'ADMIN' && ((dados.role !== undefined && dados.role !== 'ADMIN') || dados.active === false)) {
      await garantirOutroAdmin();
    }

    const usuario = await db.user.update({
      where: { id: req.params.id },
      data: { ...dados, password: dados.password ? await bcrypt.hash(dados.password, 10) : undefined },
      select: campos,
    });

    await registrarLog({ acao: 'UPDATE', entidade: 'User', id: usuario.id, req });
    res.json(comFoto(usuario));
  }),
);

rotasUsuarios.delete(
  '/:id',
  rota(async (req, res) => {
    if (req.params.id === req.usuario?.id) {
      throw new AppError('Você não pode excluir o próprio usuário');
    }

    const alvo = await db.user.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw naoEncontrado('Usuário');
    if (alvo.role === 'ADMIN') await garantirOutroAdmin();

    await db.user.delete({ where: { id: req.params.id } });
    await registrarLog({ acao: 'DELETE', entidade: 'User', id: req.params.id, req });
    res.json({ message: 'Usuário excluído com sucesso' });
  }),
);
