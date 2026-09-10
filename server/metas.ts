import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth.js';
import { AppError, dataBR, fimDoDia, inicioDoDia, numero, rota, semVazios, validar } from './core.js';
import { db } from './db.js';
import { decimal, exportar, reais } from './exportar.js';
import { exigir } from './permissoes.js';
import { unidadePermitida } from './unidades.js';
import { metaDeVendas } from './sistema.js';

/**
 * Metas de venda por vendedor. A meta é diária: tantos aparelhos por dia,
 * igual para todos. O número vive nas configurações e o resto é contado das
 * vendas.
 */

export const rotasMetas = Router();
rotasMetas.use(autenticar);

export const chaveDoVendedor = (nome: string): string =>
  nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

function pareceOMesmo(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.min(a.length, b.length) < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    if (Math.min(...atual) > 1) return false;
    anterior = atual;
  }
  return anterior[b.length] <= 1;
}

const filtros = z.object({
  inicio: z.coerce.date().optional(),
  fim: z.coerce.date().optional(),
  unitId: z.string().uuid().optional(),
});

const nomeDaVenda = (v: { sellerName: string | null; seller: { name: string } | null }) =>
  v.sellerName?.trim() || v.seller?.name?.trim() || 'Sem vendedor';

async function vendasDoPeriodo(q: z.infer<typeof filtros>, unidade: string | undefined) {
  const inicio = inicioDoDia(q.inicio ?? q.fim ?? new Date());
  const fim = fimDoDia(q.fim ?? q.inicio ?? new Date());

  const vendas = await db.sale.findMany({
    where: {
      status: 'FINALIZADA',
      saleDate: { gte: inicio, lte: fim },
      ...(unidade ? { unitId: unidade } : {}),
    },
    select: {
      code: true,
      saleDate: true,
      totalAmount: true,
      customerName: true,
      sellerName: true,
      seller: { select: { name: true } },
      unit: { select: { name: true } },
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          costPrice: true,
          productName: true,
          imei: true,
          product: {
            select: { name: true, capacity: true, color: true, category: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { saleDate: 'asc' },
  });

  const umDia = dataBR(inicio) === dataBR(fim);
  return { vendas, inicio, fim, umDia, rotulo: umDia ? dataBR(inicio) : `${dataBR(inicio)} a ${dataBR(fim)}` };
}

rotasMetas.get(
  '/',
  exigir('relatorios'),
  rota(async (req, res) => {
    const q = validar(filtros, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const [{ vendas, umDia, rotulo }, meta] = await Promise.all([
      vendasDoPeriodo(q, unidade),
      metaDeVendas(),
    ]);

    type Dia = { data: string; aparelhos: number; faturamento: number };
    const porVendedor = new Map<
      string,
      {
        nome: string;
        grafias: Set<string>;
        aparelhos: number;
        vendas: number;
        faturamento: number;
        lucro: number;
        dias: Map<string, Dia>;
      }
    >();

    for (const v of vendas) {
      const nome = nomeDaVenda(v);
      const chave = chaveDoVendedor(nome);
      const dia = dataBR(v.saleDate);

      const linha =
        porVendedor.get(chave) ??
        {
          nome,
          grafias: new Set<string>(),
          aparelhos: 0,
          vendas: 0,
          faturamento: 0,
          lucro: 0,
          dias: new Map<string, Dia>(),
        };

      const pecas = v.items.reduce((s, i) => s + i.quantity, 0);
      const valor = numero(v.totalAmount);

      linha.grafias.add(nome);
      linha.aparelhos += pecas;
      linha.vendas += 1;
      linha.faturamento += valor;
      linha.lucro += v.items.reduce(
        (s, i) => s + (numero(i.unitPrice) - numero(i.costPrice)) * i.quantity,
        0,
      );

      const doDia = linha.dias.get(dia) ?? { data: dia, aparelhos: 0, faturamento: 0 };
      doDia.aparelhos += pecas;
      doDia.faturamento += valor;
      linha.dias.set(dia, doDia);

      porVendedor.set(chave, linha);
    }

    const lista = [...porVendedor.entries()]
      .map(([chave, l]) => {
        const dias = [...l.dias.values()]
          .map((d) => ({ ...d, bateu: d.aparelhos >= meta }))
          .sort((a, b) => a.data.localeCompare(b.data));

        const hoje = dias[dias.length - 1]?.aparelhos ?? 0;
        const referencia = umDia ? hoje : l.aparelhos;

        return {
          chave,
          nome: [...l.grafias].sort((a, b) => b.length - a.length)[0],
          grafias: [...l.grafias].sort(),
          aparelhos: l.aparelhos,
          vendas: l.vendas,
          faturamento: l.faturamento,
          lucro: l.lucro,
          dias,
          diasComVenda: dias.length,
          diasBatidos: dias.filter((d) => d.bateu).length,
          meta,
          atingiu: umDia ? referencia >= meta : dias.every((d) => d.bateu),
          faltam: umDia ? Math.max(0, meta - referencia) : 0,
          progresso: meta > 0 ? Math.min(100, Math.round((referencia / meta) * 100)) : 0,
        };
      })
      .sort((a, b) => b.aparelhos - a.aparelhos);

    const parecidos: string[][] = [];
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        if (pareceOMesmo(lista[i].chave, lista[j].chave)) parecidos.push([lista[i].nome, lista[j].nome]);
      }
    }

    res.json({
      rotulo,
      umDia,
      meta,
      vendedores: lista,
      resumo: {
        vendedores: lista.length,
        bateram: lista.filter((l) => l.atingiu).length,
        aparelhos: lista.reduce((s, l) => s + l.aparelhos, 0),
        faturamento: lista.reduce((s, l) => s + l.faturamento, 0),
      },
      parecidos,
    });
  }),
);

rotasMetas.get(
  '/lista/nomes',
  rota(async (_req, res) => {
    const vendas = await db.sale.findMany({
      where: { status: 'FINALIZADA', sellerName: { not: null } },
      select: { sellerName: true },
      distinct: ['sellerName'],
      take: 300,
    });

    const melhores = new Map<string, string>();
    for (const v of vendas) {
      const nome = v.sellerName?.trim();
      if (!nome) continue;
      const chave = chaveDoVendedor(nome);
      const atual = melhores.get(chave);
      if (!atual || (atual === atual.toUpperCase() && nome !== nome.toUpperCase())) {
        melhores.set(chave, nome);
      }
    }

    res.json({ nomes: [...melhores.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')) });
  }),
);

rotasMetas.get(
  '/:chave',
  exigir('relatorios'),
  rota(async (req, res) => {
    const q = validar(
      filtros.extend({ format: z.enum(['json', 'pdf', 'xlsx', 'csv']).default('json') }),
      semVazios(req.query),
    );
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const chave = chaveDoVendedor(decodeURIComponent(req.params.chave));

    const [{ vendas, rotulo, umDia }, meta] = await Promise.all([
      vendasDoPeriodo(q, unidade),
      metaDeVendas(),
    ]);

    const minhas = vendas.filter((v) => chaveDoVendedor(nomeDaVenda(v)) === chave);
    const nome = minhas.length ? nomeDaVenda(minhas[0]) : chave;

    const itens = minhas.flatMap((v) =>
      v.items.map((i) => ({
        data: dataBR(v.saleDate),
        venda: v.code,
        produto: i.product?.name ?? i.productName ?? '—',
        detalhes: [i.product?.capacity, i.product?.color].filter(Boolean).join(' · ') || '—',
        categoria: i.product?.category?.name ?? '—',
        imei: i.imei ?? '—',
        cliente: v.customerName ?? 'Consumidor',
        unidade: v.unit?.name ?? '—',
        quantidade: i.quantity,
        valor: numero(i.unitPrice) * i.quantity,
        lucro: (numero(i.unitPrice) - numero(i.costPrice)) * i.quantity,
      })),
    );

    const aparelhos = itens.reduce((s, i) => s + i.quantidade, 0);
    const faturamento = itens.reduce((s, i) => s + i.valor, 0);
    const lucro = itens.reduce((s, i) => s + i.lucro, 0);

    const porDia = new Map<string, number>();
    for (const i of itens) porDia.set(i.data, (porDia.get(i.data) ?? 0) + i.quantidade);
    const diasBatidos = [...porDia.values()].filter((n) => n >= meta).length;

    if (q.format === 'json') {
      res.json({
        nome,
        rotulo,
        umDia,
        meta,
        itens,
        dias: [...porDia.entries()].map(([data, n]) => ({ data, aparelhos: n, bateu: n >= meta })),
        totais: {
          aparelhos,
          faturamento,
          lucro,
          vendas: new Set(itens.map((i) => i.venda)).size,
          diasComVenda: porDia.size,
          diasBatidos,
        },
      });
      return;
    }

    if (!itens.length) throw new AppError(`${nome} não tem vendas em ${rotulo}.`, 404);

    await exportar(res, q.format, {
      title: `Vendas de ${nome}`,
      subtitle: umDia
        ? `${rotulo} · ${aparelhos} de ${meta} aparelhos${aparelhos >= meta ? ' · meta batida' : ` · faltam ${meta - aparelhos}`}`
        : `${rotulo} · ${aparelhos} aparelhos · bateu a meta em ${diasBatidos} de ${porDia.size} dia(s)`,
      group: { key: 'data', totals: ['quantidade', 'valor', 'lucro'] },
      columns: [
        { header: 'Data', key: 'data', width: 11 },
        { header: 'Venda', key: 'venda', width: 12 },
        { header: 'Produto', key: 'produto', width: 26 },
        { header: 'Detalhes', key: 'detalhes', width: 15 },
        { header: 'IMEI', key: 'imei', width: 17 },
        { header: 'Cliente', key: 'cliente', width: 18 },
        { header: 'Qtd', key: 'quantidade', width: 6, align: 'right' as const },
        { header: 'Valor', key: 'valor', width: 13, align: 'right' as const, format: decimal },
        { header: 'Lucro', key: 'lucro', width: 13, align: 'right' as const, format: decimal },
      ],
      rows: itens,
      summary: [
        { label: 'Aparelhos vendidos', value: String(aparelhos) },
        { label: 'Meta por dia', value: String(meta) },
        { label: 'Dias com venda', value: String(porDia.size) },
        { label: 'Dias em que bateu', value: String(diasBatidos) },
        { label: 'Vendas', value: String(new Set(itens.map((i) => i.venda)).size) },
        { label: 'Faturamento', value: reais(faturamento) },
        { label: 'Lucro gerado', value: reais(lucro) },
      ],
    });
  }),
);
