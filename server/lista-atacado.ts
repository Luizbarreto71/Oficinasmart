import { FUSO_DA_LOJA } from './core';
import {
  emojiSugerido,
  familiaDoProduto,
  nomeParaLista,
  precoDaLista,
  RISCO_CATEGORIA,
  RISCO_TOPO,
  saudacao,
} from '../shared/lista-atacado';
import { compararProdutos } from '../shared/ordenar';

/** O que o gerador precisa saber de cada produto. */
export type ProdutoDaLista = {
  name: string;
  capacity?: string | null;
  atacado: number;
  categoriaId: string;
  categoriaNome: string;
  categoriaOrdem: number;
};

type Linha = { nome: string; preco: number; familia: string };

function agoraNaLoja(momento: Date): { data: string; hora: number } {
  const data = momento.toLocaleDateString('pt-BR', {
    timeZone: FUSO_DA_LOJA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const hora = Number(
    momento.toLocaleString('pt-BR', { timeZone: FUSO_DA_LOJA, hour: '2-digit', hour12: false }),
  );

  return { data, hora: Number.isFinite(hora) ? hora : 12 };
}

/**
 * Monta a mensagem do grupo de atacado. O texto é o produto final: vai ser
 * colado no WhatsApp exatamente como sai daqui.
 */
export function montarListaDeAtacado(
  produtos: ProdutoDaLista[],
  emojis: Record<string, string>,
  momento = new Date(),
): { texto: string; resumo: { linhas: number; categorias: number; juntados: number } } {
  const { data, hora } = agoraNaLoja(momento);

  const partes: string[] = [RISCO_TOPO, `📅 ${saudacao(hora)} - ${data} 📅`, RISCO_TOPO, ''];

  const categorias = new Map<string, { nome: string; ordem: number; itens: ProdutoDaLista[] }>();

  for (const p of produtos) {
    const bloco = categorias.get(p.categoriaId);
    if (bloco) bloco.itens.push(p);
    else categorias.set(p.categoriaId, { nome: p.categoriaNome, ordem: p.categoriaOrdem, itens: [p] });
  }

  const ordenadas = [...categorias.entries()].sort(
    ([, a], [, b]) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'),
  );

  let totalDeLinhas = 0;
  let juntados = 0;

  for (const [categoriaId, bloco] of ordenadas) {
    const emoji = emojis[categoriaId]?.trim() || emojiSugerido(bloco.nome);

    partes.push(RISCO_CATEGORIA, `${emoji} ${bloco.nome}`, RISCO_CATEGORIA, '');

    const linhas: Linha[] = [];

    for (const p of [...bloco.itens].sort(compararProdutos)) {
      const nome = nomeParaLista(p.name);

      const repetida = linhas.some((l) => l.nome === nome && l.preco === p.atacado);
      if (repetida) {
        juntados += 1;
        continue;
      }

      linhas.push({ nome, preco: p.atacado, familia: familiaDoProduto(p.name) });
    }

    linhas.forEach((linha, i) => {
      if (i > 0 && linha.familia !== linhas[i - 1].familia) partes.push('');
      partes.push(`${emoji} - ${linha.nome} - ${precoDaLista(linha.preco)};`);
    });

    partes.push('');
    totalDeLinhas += linhas.length;
  }

  while (partes.length && partes[partes.length - 1] === '') partes.pop();

  return {
    texto: partes.join('\n'),
    resumo: { linhas: totalDeLinhas, categorias: ordenadas.length, juntados },
  };
}
