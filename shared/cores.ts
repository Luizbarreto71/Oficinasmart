/**
 * Cores das categorias.
 *
 * A bolinha ao lado do nome é o que deixa a lista de estoque legível de
 * relance — mas só funciona se cada categoria tiver a sua. Categoria sem
 * cor sai cinza e some no meio das outras.
 */
export const PALETA_DE_CATEGORIAS = [
  '#3B82F6', // azul
  '#22C55E', // verde
  '#F97316', // laranja
  '#8B5CF6', // roxo
  '#EAB308', // âmbar
  '#EC4899', // rosa
  '#14B8A6', // turquesa
  '#06B6D4', // ciano
  '#6366F1', // índigo
  '#EF4444', // vermelho
  '#84CC16', // limão
  '#A855F7', // violeta
] as const;

/**
 * Escolhe uma cor ainda não usada.
 *
 * Repete só quando a paleta acaba — com doze cores, isso não acontece numa
 * loja de verdade.
 */
export function proximaCor(jaUsadas: (string | null | undefined)[]): string {
  const usadas = new Set(jaUsadas.filter(Boolean).map((c) => c!.toUpperCase()));
  const livre = PALETA_DE_CATEGORIAS.find((c) => !usadas.has(c));
  return livre ?? PALETA_DE_CATEGORIAS[usadas.size % PALETA_DE_CATEGORIAS.length];
}
