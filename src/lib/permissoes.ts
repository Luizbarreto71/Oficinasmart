import type { UserRole } from '@/types';

/**
 * Espelho das permissões do servidor (`server/permissoes.ts`).
 *
 * Serve só para montar o menu e esconder botões. A checagem que protege de
 * verdade é a da API.
 */
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

export const PERMISSOES: Record<UserRole, Permissao[]> = {
  ADMIN: TODAS,
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

export const pode = (papel: UserRole | undefined, permissao: Permissao): boolean =>
  Boolean(papel && PERMISSOES[papel]?.includes(permissao));

/** Primeira tela que cada perfil vê ao entrar. */
export const telaInicial = (papel: UserRole | undefined): string => {
  if (pode(papel, 'dashboard')) return '/';
  if (pode(papel, 'pdv')) return '/caixa';
  if (pode(papel, 'prevenda.criar')) return '/pre-vendas';
  return '/estoque';
};
