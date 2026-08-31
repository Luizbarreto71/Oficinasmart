/**
 * Taxas da maquininha, por parcela.
 *
 * Duas colunas porque a bandeira muda o custo: Elo e Amex cobram mais que
 * Visa e Mastercard. Acima de 12x a maquininha da loja tem taxa única, e aí
 * `elo` fica vazio.
 */
export interface TaxaDeCartao {
  parcelas: number;
  /** Visa, Mastercard e as demais. */
  padrao: number;
  /** Elo e Amex. Vazio = vale a taxa padrão. */
  elo?: number | null;
}

/** O que a loja usa hoje. Serve de ponto de partida e de "restaurar". */
export const TAXAS_PADRAO: TaxaDeCartao[] = [
  { parcelas: 1, padrao: 5.5, elo: 6.5 },
  { parcelas: 2, padrao: 6.0, elo: 7.0 },
  { parcelas: 3, padrao: 6.5, elo: 7.5 },
  { parcelas: 4, padrao: 7.0, elo: 8.0 },
  { parcelas: 5, padrao: 7.5, elo: 8.5 },
  { parcelas: 6, padrao: 7.5, elo: 8.5 },
  { parcelas: 7, padrao: 8.0, elo: 9.0 },
  { parcelas: 8, padrao: 8.5, elo: 9.5 },
  { parcelas: 9, padrao: 9.0, elo: 10.0 },
  { parcelas: 10, padrao: 9.5, elo: 10.5 },
  { parcelas: 11, padrao: 10.0, elo: 11.0 },
  { parcelas: 12, padrao: 10.5, elo: 11.5 },
  { parcelas: 13, padrao: 14.0, elo: null },
  { parcelas: 14, padrao: 14.5, elo: null },
  { parcelas: 15, padrao: 15.0, elo: null },
  { parcelas: 16, padrao: 15.5, elo: null },
  { parcelas: 17, padrao: 16.0, elo: null },
  { parcelas: 18, padrao: 16.5, elo: null },
];

export type Bandeira = 'padrao' | 'elo';

/** A taxa que vale para estas parcelas e esta bandeira. */
export function taxaDe(
  tabela: TaxaDeCartao[],
  parcelas: number,
  bandeira: Bandeira,
): number | null {
  const linha = tabela.find((t) => t.parcelas === parcelas);
  if (!linha) return null;
  return bandeira === 'elo' ? (linha.elo ?? linha.padrao) : linha.padrao;
}

/**
 * Quanto cobrar no cartão para a loja receber o valor à vista.
 *
 * Divide em vez de somar a porcentagem. Somar 5,5% sobre R$ 1.000 dá
 * R$ 1.055, e a maquininha desconta 5,5% *disso* — sobram R$ 996,80.
 * Dividindo, a conta fecha.
 */
export function valorNoCartao(valorAVista: number, taxa: number): number {
  if (taxa <= 0 || taxa >= 100) return arredondar(valorAVista);
  return arredondar(valorAVista / (1 - taxa / 100));
}

/** O que cai na conta depois do desconto da maquininha. */
export const liquidoRecebido = (valorCobrado: number, taxa: number) =>
  arredondar(valorCobrado * (1 - taxa / 100));

const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Aceita o que veio do banco, descartando linha malformada. */
export function normalizarTaxas(bruto: unknown): TaxaDeCartao[] {
  if (!Array.isArray(bruto)) return TAXAS_PADRAO;

  const limpas = bruto
    .map((linha) => {
      if (!linha || typeof linha !== 'object') return null;
      const { parcelas, padrao, elo } = linha as Record<string, unknown>;
      const p = Number(parcelas);
      const t = Number(padrao);
      if (!Number.isInteger(p) || p < 1 || p > 24) return null;
      if (!Number.isFinite(t) || t < 0 || t >= 100) return null;

      const e = elo === null || elo === undefined || elo === '' ? null : Number(elo);
      return {
        parcelas: p,
        padrao: t,
        elo: e !== null && Number.isFinite(e) && e >= 0 && e < 100 ? e : null,
      };
    })
    .filter((l): l is { parcelas: number; padrao: number; elo: number | null } => l !== null)
    .sort((a, b) => a.parcelas - b.parcelas);

  return limpas.length ? limpas : TAXAS_PADRAO;
}
