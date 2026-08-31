/**
 * Catálogo de campos do cadastro de produto.
 *
 * Cada categoria escolhe quais destes campos aparecem no seu formulário —
 * a escolha é feita em Configurações → Categorias e fica guardada no banco.
 *
 * Este arquivo é usado pelo site e pela API, por isso mora fora das duas
 * pastas.
 */

export type TipoCampo =
  | 'texto'
  | 'texto-longo'
  | 'inteiro'
  | 'percentual'
  | 'dinheiro'
  | 'data'
  | 'codigo-barras'
  | 'selecao'
  | 'fornecedor'
  | 'status'
  | 'fotos';

export interface DefinicaoCampo {
  /** Rótulo padrão, usado quando a categoria não define um próprio. */
  rotulo: string;
  tipo: TipoCampo;
  /** Coluna correspondente na tabela de produtos (ou do aparelho). */
  coluna: string;
  /** Campos essenciais: não podem ser desmarcados (mas podem ser renomeados). */
  essencial?: boolean;
  /** Só faz sentido para produtos controlados por aparelho (UNITARIO). */
  somenteUnitario?: boolean;
  /** Texto de apoio mostrado abaixo do campo. */
  ajuda?: string;
  exemplo?: string;
  /** Alternativas do campo, quando o tipo é 'selecao'. */
  opcoes?: string[];
}

const CATALOGO = {
  nome: {
    rotulo: 'Nome do produto',
    tipo: 'texto',
    coluna: 'name',
    essencial: true,
    ajuda: 'É o que aparece na lista, na venda e nos relatórios',
    exemplo: 'iPhone 15 Pro Max',
  },
  marca: { rotulo: 'Marca', tipo: 'texto', coluna: 'brand', exemplo: 'Apple' },
  modelo: { rotulo: 'Modelo', tipo: 'texto', coluna: 'model', exemplo: '15 Pro Max' },
  cor: { rotulo: 'Cor', tipo: 'texto', coluna: 'color', exemplo: 'Titânio' },
  capacidade: { rotulo: 'Capacidade', tipo: 'texto', coluna: 'capacity', exemplo: '256GB' },
  ram: { rotulo: 'Memória RAM', tipo: 'texto', coluna: 'ram', exemplo: '8GB' },
  lote: { rotulo: 'Lote', tipo: 'texto', coluna: 'lote', exemplo: 'AB1234' },
  condicao: {
    rotulo: 'Condição',
    tipo: 'selecao',
    coluna: 'condicao',
    opcoes: ['Novo / Lacrado', 'Recondicionado', 'Vitrine', 'Seminovo', 'Usado'],
    ajuda: 'Estado do produto no cadastro. Para aparelhos, cada peça guarda a sua.',
  },
  imei: {
    rotulo: 'IMEI',
    tipo: 'texto',
    coluna: 'imei',
    somenteUnitario: true,
    ajuda: 'Único no sistema — não deixa cadastrar o mesmo aparelho duas vezes',
    exemplo: '356938035643809',
  },
  imei2: {
    rotulo: 'IMEI 2 (dual-SIM)',
    tipo: 'texto',
    coluna: 'imei2',
    somenteUnitario: true,
  },
  serie: { rotulo: 'Número de série', tipo: 'texto', coluna: 'serialNumber', exemplo: 'SN-000123' },
  bateria: {
    rotulo: 'Saúde da bateria',
    tipo: 'percentual',
    coluna: 'batteryHealth',
    somenteUnitario: true,
    ajuda: '0 a 100 — quando o aparelho informa',
  },
  garantia: {
    rotulo: 'Garantia (dias)',
    tipo: 'inteiro',
    coluna: 'garantiaPadraoDias',
    ajuda: 'Garantia da loja sugerida ao dar entrada de um aparelho',
  },
  codigo: { rotulo: 'Código de barras', tipo: 'codigo-barras', coluna: 'barcode' },
  quantidade: {
    rotulo: 'Quantidade',
    tipo: 'inteiro',
    coluna: 'quantity',
    essencial: true,
  },
  minimo: {
    rotulo: 'Estoque mínimo',
    tipo: 'inteiro',
    coluna: 'minQuantity',
    ajuda: 'Abaixo disso o produto entra no alerta',
  },
  custo: {
    rotulo: 'Custo médio',
    tipo: 'dinheiro',
    coluna: 'costPrice',
    ajuda: 'No cadastro é o custo inicial; depois cada entrada recalcula',
  },
  venda: {
    rotulo: 'Preço de venda (varejo)',
    tipo: 'dinheiro',
    coluna: 'salePrice',
    ajuda: 'Opcional — se ficar vazio, vale o preço de atacado',
  },
  atacado: {
    rotulo: 'Preço de atacado',
    tipo: 'dinheiro',
    coluna: 'wholesalePrice',
  },
  fornecedor: { rotulo: 'Fornecedor', tipo: 'fornecedor', coluna: 'supplierId' },
  status: { rotulo: 'Status', tipo: 'status', coluna: 'status' },
  entrada: { rotulo: 'Data de entrada', tipo: 'data', coluna: 'entryDate' },
  fotos: { rotulo: 'Fotos do produto', tipo: 'fotos', coluna: 'photos' },
  observacoes: { rotulo: 'Observações', tipo: 'texto-longo', coluna: 'notes' },
} satisfies Record<string, DefinicaoCampo>;

export type ChaveCampo = keyof typeof CATALOGO;

export const CAMPOS: Record<ChaveCampo, DefinicaoCampo> = CATALOGO;

export const TODAS_AS_CHAVES = Object.keys(CATALOGO) as ChaveCampo[];

export const ehChaveValida = (v: string): v is ChaveCampo => v in CAMPOS;

/** Um campo dentro da configuração de uma categoria. */
export interface CampoDaCategoria {
  campo: ChaveCampo;
  rotulo?: string;
  obrigatorio?: boolean;
}

/** Rótulo final de um campo: o da categoria, ou o padrão do catálogo. */
export const rotuloDoCampo = (c: CampoDaCategoria): string =>
  c.rotulo?.trim() || CAMPOS[c.campo].rotulo;

/**
 * Configuração inicial de cada categoria. Serve de ponto de partida — a
 * partir daí tudo é ajustável pela tela de Configurações.
 */
export const PADROES: Record<string, CampoDaCategoria[]> = {
  // Aparelhos: controle por unidade. IMEI, bateria e garantia por peça.
  smartphones: [
    { campo: 'nome' },
    { campo: 'marca' },
    { campo: 'modelo' },
    { campo: 'cor' },
    { campo: 'capacidade' },
    { campo: 'ram' },
    { campo: 'imei' },
    { campo: 'serie' },
    { campo: 'condicao' },
    { campo: 'bateria' },
    { campo: 'garantia' },
    { campo: 'quantidade' },
    { campo: 'custo' },
    { campo: 'venda' },
    { campo: 'atacado' },
    { campo: 'fornecedor' },
    { campo: 'fotos' },
    { campo: 'observacoes' },
  ],

  acessorios: [
    { campo: 'nome' },
    { campo: 'marca' },
    { campo: 'modelo' },
    { campo: 'cor' },
    { campo: 'codigo' },
    { campo: 'quantidade' },
    { campo: 'minimo' },
    { campo: 'custo' },
    { campo: 'venda' },
    { campo: 'atacado' },
    { campo: 'fornecedor' },
    { campo: 'fotos' },
    { campo: 'observacoes' },
  ],

  pecas: [
    { campo: 'nome' },
    { campo: 'modelo', rotulo: 'Compatível com' },
    { campo: 'condicao', rotulo: 'Tipo / qualidade' },
    { campo: 'codigo' },
    { campo: 'quantidade' },
    { campo: 'minimo' },
    { campo: 'custo' },
    { campo: 'venda' },
    { campo: 'fornecedor' },
    { campo: 'fotos' },
    { campo: 'observacoes' },
  ],

  servicos: [
    { campo: 'nome', rotulo: 'Serviço' },
    { campo: 'venda', rotulo: 'Valor' },
    { campo: 'custo', rotulo: 'Custo da peça / terceiro' },
    { campo: 'observacoes' },
  ],

  seminovos: [
    { campo: 'nome' },
    { campo: 'marca' },
    { campo: 'modelo' },
    { campo: 'cor' },
    { campo: 'capacidade' },
    { campo: 'imei' },
    { campo: 'bateria' },
    { campo: 'garantia' },
    { campo: 'quantidade' },
    { campo: 'custo' },
    { campo: 'venda' },
    { campo: 'fornecedor' },
    { campo: 'fotos' },
    { campo: 'observacoes' },
  ],
};

/** Usado por categorias novas, criadas por você depois. */
export const PADRAO_GENERICO: CampoDaCategoria[] = [
  { campo: 'nome' },
  { campo: 'marca' },
  { campo: 'modelo' },
  { campo: 'quantidade' },
  { campo: 'custo' },
  { campo: 'venda' },
  { campo: 'fornecedor' },
  { campo: 'fotos' },
  { campo: 'observacoes' },
];

const APOSENTADOS = new Set<string>([]);

/**
 * Lê a configuração vinda do banco, descartando o que estiver inválido e
 * garantindo que os campos essenciais estejam presentes.
 */
export function normalizarCampos(bruto: unknown, slug?: string): CampoDaCategoria[] {
  const padrao = (slug && PADROES[slug]) || PADRAO_GENERICO;

  const lista = Array.isArray(bruto)
    ? bruto
        .map((item) => {
          if (typeof item === 'string') return ehChaveValida(item) ? { campo: item } : null;
          if (item && typeof item === 'object') {
            const { campo, rotulo, obrigatorio } = item as Record<string, unknown>;
            if (typeof campo === 'string' && ehChaveValida(campo)) {
              return {
                campo,
                ...(typeof rotulo === 'string' && rotulo.trim() ? { rotulo: rotulo.trim() } : {}),
                ...(obrigatorio === true ? { obrigatorio: true } : {}),
              };
            }
          }
          return null;
        })
        .filter((c): c is CampoDaCategoria => c !== null)
    : padrao;

  const escolhidos = (lista.length ? lista : padrao).filter((c) => !APOSENTADOS.has(c.campo));

  const presentes = new Set(escolhidos.map((c) => c.campo));
  const faltando = TODAS_AS_CHAVES.filter(
    (k) => CAMPOS[k].essencial && !presentes.has(k) && !APOSENTADOS.has(k),
  ).map((campo) => ({ campo }));

  return [...escolhidos, ...faltando];
}

/** Converte para o formato que o Prisma aceita numa coluna Json. */
export const camposParaJson = (campos: CampoDaCategoria[]): object[] =>
  JSON.parse(JSON.stringify(campos)) as object[];
