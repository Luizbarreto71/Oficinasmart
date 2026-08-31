/**
 * Custo médio ponderado — a conta que a loja realmente precisa.
 *
 * Trocar o custo pelo da última nota distorce a margem: quem comprou 10 a
 * R$ 100 e mais 6 a R$ 160 não passou a ter 16 peças de R$ 160. Vive no
 * `shared` porque a tela mostra a prévia antes de gravar, e prévia que não
 * bate com o resultado é pior que prévia nenhuma.
 */
export function custoMedio(
  saldoAtual: number,
  custoMedioAtual: number,
  quantidadeNova: number,
  custoDaNota: number,
): number {
  // Estoque zerado (ou negativo por acerto) não tem o que ponderar: a nota
  // nova passa a ser o custo.
  if (saldoAtual <= 0) return arredondar(custoDaNota);
  if (quantidadeNova <= 0) return arredondar(custoMedioAtual);

  const total = saldoAtual * custoMedioAtual + quantidadeNova * custoDaNota;
  return arredondar(total / (saldoAtual + quantidadeNova));
}

/** Duas casas, arredondando meio para cima — como o banco guarda. */
const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
