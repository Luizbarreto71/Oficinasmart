import type { NextFunction, Request, Response } from 'express';
import { AppError } from './core.js';

/**
 * Quem pode o quê.
 *
 * Isto é a fonte da verdade — o menu do site apenas reflete o que está
 * aqui. Esconder um botão não protege nada: a checagem que vale é esta,
 * na API.
 */

export type Perfil = 'ADMIN' | 'GERENTE' | 'CAIXA' | 'VENDEDOR';

export const PERFIS: Perfil[] = ['ADMIN', 'GERENTE', 'CAIXA', 'VENDEDOR'];

/** Cada permissão é um verbo do sistema, não uma tela. */
export type Permissao =
  | 'dashboard'
  | 'produtos.ver'
  | 'produtos.editar'
  | 'estoque.ver'
  | 'estoque.tela'
  | 'estoque.movimentar'
  | 'estoque.transferir'
  | 'retirada.aprovar'
  | 'prevenda.criar'
  | 'troca.criar'
  | 'prevenda.verTodas'
  | 'pdv'
  | 'venda.finalizar'
  | 'venda.cancelar'
  | 'caixa.fechar'
  | 'caixa.verTodos'
  | 'os.ver'
  | 'os.criar'
  | 'os.editar'
  | 'os.orcar'
  | 'os.entregar'
  | 'relatorios'
  | 'financeiro'
  | 'usuarios'
  | 'configuracoes';

const TODAS: Permissao[] = [
  'dashboard',
  'produtos.ver',
  'produtos.editar',
  'estoque.ver',
  'estoque.tela',
  'estoque.movimentar',
  'estoque.transferir',
  'retirada.aprovar',
  'prevenda.criar',
  'troca.criar',
  'prevenda.verTodas',
  'pdv',
  'venda.finalizar',
  'venda.cancelar',
  'caixa.fechar',
  'caixa.verTodos',
  'os.ver',
  'os.criar',
  'os.editar',
  'os.orcar',
  'os.entregar',
  'relatorios',
  'financeiro',
  'usuarios',
  'configuracoes',
];

export const PERMISSOES: Record<Perfil, Permissao[]> = {
  ADMIN: TODAS,

  // Toca no estoque da sua unidade, mas não mexe em usuários nem no caixa.
  GERENTE: [
    'dashboard',
    'produtos.ver',
    'produtos.editar',
    'estoque.ver',
    'estoque.tela',
    'estoque.movimentar',
    'estoque.transferir',
    'prevenda.criar',
    'prevenda.verTodas',
    'troca.criar',
    'os.ver',
    'os.criar',
    'os.editar',
    'os.orcar',
    'os.entregar',
    'relatorios',
  ],

  // Recebe, confere e finaliza. Não cadastra nem altera preço.
  CAIXA: [
    'produtos.ver',
    'prevenda.verTodas',
    'troca.criar',
    'pdv',
    'venda.finalizar',
    'venda.cancelar',
    'caixa.fechar',
    'os.ver',
    'os.criar',
    'os.entregar',
  ],

  // Monta a intenção de venda e dá entrada de OS no balcão. Nunca baixa estoque.
  VENDEDOR: [
    'produtos.ver',
    'estoque.ver',
    'estoque.tela',
    'prevenda.criar',
    'troca.criar',
    'os.ver',
    'os.criar',
  ],
};

export const podeFazer = (perfil: string | undefined, permissao: Permissao): boolean =>
  Boolean(perfil && PERMISSOES[perfil as Perfil]?.includes(permissao));

/** Middleware: barra na API quem não tem a permissão. */
export function exigir(permissao: Permissao) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.usuario) return next(new AppError('Não autorizado', 401));

    if (!podeFazer(req.usuario.papel, permissao)) {
      return next(new AppError('Você não tem permissão para esta ação', 403));
    }
    next();
  };
}

/** Lista enviada ao site para montar o menu. */
export const permissoesDoPerfil = (perfil: string | undefined): Permissao[] =>
  PERMISSOES[perfil as Perfil] ?? [];
