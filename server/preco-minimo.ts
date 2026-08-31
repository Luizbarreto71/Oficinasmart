import { AppError, numero } from './core';
import { db } from './db';
import { conferirChaveDeAcesso, temChaveDeAcesso } from './sistema';

/**
 * O preço de atacado é o piso da venda.
 *
 * Abaixo dele a loja perde dinheiro sem ninguém perceber. Vender abaixo
 * continua possível, mas exige a chave do dono: vira decisão dele, não do
 * balcão.
 */
export async function exigirChaveSeAbaixoDoMinimo(
  itens: { productId: string; unitPrice: number }[],
  chave: string | null | undefined,
): Promise<void> {
  if (!itens.length) return;

  const produtos = await db.product.findMany({
    where: { id: { in: itens.map((i) => i.productId) } },
    select: { id: true, name: true, wholesalePrice: true },
  });

  const abaixo = itens.flatMap((item) => {
    const produto = produtos.find((p) => p.id === item.productId);
    if (!produto?.wholesalePrice) return [];

    const minimo = numero(produto.wholesalePrice);
    if (item.unitPrice >= minimo) return [];

    return [{ nome: produto.name, cobrado: item.unitPrice, minimo }];
  });

  if (!abaixo.length) return;

  const lista = abaixo
    .map((a) => `${a.nome} por R$ ${a.cobrado.toFixed(2)} (mínimo R$ ${a.minimo.toFixed(2)})`)
    .join('; ');

  if (await conferirChaveDeAcesso(chave)) return;

  if (!(await temChaveDeAcesso())) {
    throw new AppError(
      `Abaixo do preço de atacado: ${lista}. Nenhuma chave de acesso foi cadastrada — ` +
        'peça ao administrador para criar uma em Configurações.',
      403,
    );
  }

  throw new AppError(
    chave?.trim()
      ? `Chave de acesso incorreta. ${lista}.`
      : `Abaixo do preço de atacado: ${lista}. Informe a chave de acesso do administrador.`,
    403,
  );
}
