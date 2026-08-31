/**
 * Regras de texto da lista que vai para o grupo de atacado.
 *
 * Ficam aqui, e não no servidor, porque a tela de configuração precisa
 * sugerir o mesmo emoji que o gerador usaria.
 */

/** Emoji usado quando a categoria não se parece com nenhuma conhecida. */
export const EMOJI_PADRAO = '📦';

/**
 * Emoji sugerido a partir do nome da categoria.
 *
 * A ordem importa: "Acessórios › Fones" tem as duas palavras, e o fone é o
 * que descreve a mercadoria.
 */
const POR_NOME: { procura: RegExp; emoji: string }[] = [
  { procura: /fone|headphone|airpod|earbud|buds/i, emoji: '🎧' },
  { procura: /watch|rel[oó]gio|smartwatch/i, emoji: '⌚' },
  { procura: /pel[ií]cula|vidro|glass/i, emoji: '🛡️' },
  { procura: /capa|case|capinha/i, emoji: '🧷' },
  { procura: /carregador|cabo|fonte|power ?bank|bateria/i, emoji: '🔌' },
  { procura: /pe[çc]a|tela|display|flex|conector|alto-?falante/i, emoji: '🔧' },
  { procura: /servi[çc]o|reparo|conserto|m[ãa]o de obra/i, emoji: '🛠️' },
  { procura: /caixa de som|som\b|speaker/i, emoji: '🔉' },
  { procura: /celular|iphone|smartphone|xiaomi|redmi|poco|realme|samsung|motorola|aparelho/i, emoji: '📱' },
];

/** O emoji que a categoria ganha quando ninguém escolheu um. */
export function emojiSugerido(nomeDaCategoria: string): string {
  const achou = POR_NOME.find((r) => r.procura.test(nomeDaCategoria));
  return achou?.emoji ?? EMOJI_PADRAO;
}

/** Linha decorativa do cabeçalho do dia. */
export const RISCO_TOPO = '——————————————————';

/** Linha decorativa que abre e fecha o título de cada categoria. */
export const RISCO_CATEGORIA = '——–——–——–——–';

/**
 * Cores escritas dentro do nome do produto.
 *
 * O cadastro guarda "IPHONE 17 256GB VERDE" — a cor faz parte do nome, não
 * de um campo. No atacado ela só polui.
 */
const CORES = [
  'PRETO', 'PRETA', 'BRANCO', 'BRANCA', 'AZUL', 'VERDE', 'VERMELHO', 'VERMELHA',
  'ROXO', 'ROXA', 'ROSA', 'AMARELO', 'AMARELA', 'LARANJA', 'DOURADO', 'DOURADA',
  'PRATA', 'PRATEADO', 'CINZA', 'GRAFITE', 'TITANIO', 'BEGE', 'LILAS', 'CIANO',
  'MARROM', 'CORAL', 'MIDNIGHT', 'STARLIGHT', 'ESCURO', 'CLARO', 'FOSCO',
];

const semAcento = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * O nome como ele deve chegar no grupo.
 */
export function nomeParaLista(bruto: string): string {
  let nome = bruto.trim().replace(/\s+/g, ' ');

  nome = nome.replace(/(\d+)\s*(gb|tb)\b/gi, (_, n: string, u: string) => `${n}${u.toUpperCase()}`);

  const partes = nome.split(' ');
  while (partes.length > 1 && CORES.includes(semAcento(partes[partes.length - 1]))) {
    partes.pop();
  }

  return partes.join(' ');
}

/**
 * A que família o produto pertence, para saber onde cai a linha em branco.
 */
export function familiaDoProduto(nome: string): string {
  const partes = nomeParaLista(nome)
    .split(' ')
    .filter((t) => !/^\d+(GB|TB)$/i.test(t) && !/^\d+\s*\/\s*\d+$/.test(t));

  if (partes.length >= 3 && /^\d+$/.test(partes[partes.length - 1])) partes.pop();

  return semAcento(partes.join(' '));
}

/** R$ 5.080,00 — sempre com ponto no milhar e vírgula no centavo. */
export function precoDaLista(valor: number): string {
  const numero = valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${numero}`;
}

/** Saudação de acordo com a hora da loja. */
export function saudacao(hora: number): string {
  if (hora < 12) return 'BOM DIA';
  if (hora < 18) return 'BOA TARDE';
  return 'BOA NOITE';
}
