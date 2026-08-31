/**
 * Dados da loja que aparecem no comprovante.
 *
 * Ficam em configuração, e não no código, porque endereço e telefone mudam
 * — e um comprovante com o contato errado é pior do que sem contato.
 */
export interface DadosDaLoja {
  nome: string;
  documento: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  /** Linha livre no rodapé: garantia, trocas, redes sociais. */
  rodape: string;
}

export const LOJA_PADRAO: DadosDaLoja = {
  nome: 'Oficina do Smartphone',
  documento: '',
  endereco: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  telefone: '',
  email: '',
  rodape: '',
};

/** Aceita o que veio do banco, campo a campo, sem quebrar se faltar algum. */
export function normalizarLoja(bruto: unknown): DadosDaLoja {
  if (!bruto || typeof bruto !== 'object') return LOJA_PADRAO;
  const dado = bruto as Record<string, unknown>;

  const texto = (chave: keyof DadosDaLoja) =>
    typeof dado[chave] === 'string' ? (dado[chave] as string).trim() : LOJA_PADRAO[chave];

  return {
    nome: texto('nome') || LOJA_PADRAO.nome,
    documento: texto('documento'),
    endereco: texto('endereco'),
    bairro: texto('bairro'),
    cidade: texto('cidade'),
    uf: texto('uf').toUpperCase().slice(0, 2),
    cep: texto('cep'),
    telefone: texto('telefone'),
    email: texto('email'),
    rodape: texto('rodape'),
  };
}

/** "Rua X, 27 - Centro" — só o que estiver preenchido. */
export const linhaDeEndereco = (l: DadosDaLoja) =>
  [l.endereco, l.bairro].filter(Boolean).join(' - ');

/** "Aracaju/SE - CEP: 49000-000" */
export const linhaDeCidade = (l: DadosDaLoja) =>
  [[l.cidade, l.uf].filter(Boolean).join('/'), l.cep && `CEP: ${l.cep}`]
    .filter(Boolean)
    .join(' - ');
