/**
 * O que se pergunta ao receber um aparelho usado como entrada.
 *
 * Fica aqui, e não em cada tela, porque o mesmo vocabulário precisa valer
 * no formulário do vendedor, na conferência do caixa e no relatório — se
 * cada um tiver a sua lista, o histórico deixa de ser comparável.
 */

/** Defeitos marcados com um toque, sem precisar escrever. */
export const DEFEITOS = [
  { chave: 'bateria', rotulo: 'Bateria ruim' },
  { chave: 'tela', rotulo: 'Tela com avaria' },
  { chave: 'traseira', rotulo: 'Traseira trincada' },
  { chave: 'camera', rotulo: 'Câmera com problema' },
  { chave: 'botoes', rotulo: 'Botões falhando' },
  { chave: 'carga', rotulo: 'Não carrega direito' },
  { chave: 'biometria', rotulo: 'Biometria / Face ID não funciona' },
  { chave: 'molhado', rotulo: 'Já tomou água' },
  { chave: 'reparo', rotulo: 'Já foi aberto / tem peça trocada' },
  { chave: 'conta', rotulo: 'Conta do fabricante ainda logada' },
] as const;

export type ChaveDefeito = (typeof DEFEITOS)[number]['chave'];

export const DEFEITO_ROTULO: Record<string, string> = Object.fromEntries(
  DEFEITOS.map((d) => [d.chave, d.rotulo]),
);

/** Estado geral, do jeito que se fala no balcão. */
export const ESTADOS = ['Excelente', 'Bom', 'Regular', 'Ruim'] as const;

/** Armazenamentos que aparecem no dia a dia. Aceita digitar outro. */
export const ARMAZENAMENTOS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] as const;

/**
 * O que a consulta da Anatel devolveu.
 *
 * A Anatel não abre consulta automática — a página oficial exige "não sou
 * um robô". Então quem consulta é a pessoa, e o sistema guarda o resultado
 * junto com o print.
 */
export const SITUACOES_IMEI = [
  { chave: 'NAO_CONSULTADO', rotulo: 'Ainda não consultei', tom: 'neutral' },
  { chave: 'REGULAR', rotulo: 'Regular', tom: 'success' },
  { chave: 'IRREGULAR', rotulo: 'Irregular / não homologado', tom: 'warning' },
  { chave: 'BLOQUEADO', rotulo: 'Roubado, furtado ou bloqueado', tom: 'danger' },
] as const;

export type SituacaoImei = (typeof SITUACOES_IMEI)[number]['chave'];

export const SITUACAO_IMEI_ROTULO: Record<string, string> = Object.fromEntries(
  SITUACOES_IMEI.map((s) => [s.chave, s.rotulo]),
);

/** Página oficial de consulta. Abre em outra aba, com o IMEI copiado. */
export const ANATEL_URL = 'https://www.gov.br/anatel/pt-br/assuntos/celular-legal/consulte-sua-situacao';

/**
 * Confere o dígito verificador do IMEI (algoritmo de Luhn).
 *
 * Não diz se o aparelho é roubado — isso só a Anatel responde. Serve para
 * pegar erro de digitação na hora, e não depois que o cliente já foi embora.
 */
export function imeiValido(imei: string): boolean {
  const numeros = imei.replace(/\D/g, '');
  if (numeros.length !== 15) return false;

  let soma = 0;
  for (let i = 0; i < 15; i += 1) {
    let d = Number(numeros[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
  }
  return soma % 10 === 0;
}
