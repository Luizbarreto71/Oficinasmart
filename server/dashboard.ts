import { Router } from 'express';
import { autenticar } from './auth.js';
import { fimDoDia, FUSO_DA_LOJA, inicioDoDia, limpar, numero, rota, somarDias } from './core.js';
import { exigir } from './permissoes.js';
import { db } from './db.js';
import { estoqueBaixo, totalEmEstoque, valorDoEstoque } from './estoque.js';
import { unidadePermitida } from './unidades.js';

/**
 * Cards, gráfico e alertas da tela inicial.
 *
 * Tudo aceita `unitId`: sem ele, mostra o consolidado das unidades; com ele,
 * só aquela loja. Gerente e Vendedor caem sempre na própria unidade.
 */

export const rotasDashboard = Router();
rotasDashboard.use(autenticar, exigir('dashboard'));

rotasDashboard.get(
  '/',
  rota(async (req, res) => {
    const dias = Math.min(90, Math.max(7, Number(req.query.days) || 14));
    const unidade = unidadePermitida(req.usuario, req.query.unitId as string | undefined);
    const naUnidade = unidade ? { unitId: unidade } : {};

    const escolhida = req.query.date ? new Date(String(req.query.date)) : null;
    const hoje = escolhida && !Number.isNaN(escolhida.getTime()) ? escolhida : new Date();

    const inicioHoje = inicioDoDia(hoje);
    const fimHoje = fimDoDia(hoje);
    const inicioGrafico = inicioDoDia(somarDias(hoje, -(dias - 1)));
    const inicioDoMes = inicioDoDia(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)));

    const baixos = await estoqueBaixo(unidade, 10);

    const [
      totalProdutos,
      itensEmEstoque,
      vendidosHoje,
      itensHoje,
      faturamentoHoje,
      produtosBaixos,
      semEstoque,
      ultimasVendas,
      vendasDoPeriodo,
      movimentosDoPeriodo,
      linhasDeEstoque,
      categorias,
      mes,
      itensMes,
      valor,
    ] = await Promise.all([
      db.product.count(),
      totalEmEstoque(unidade),
      db.sale.aggregate({
        where: { status: 'FINALIZADA', saleDate: { gte: inicioHoje, lte: fimHoje }, ...naUnidade },
        _count: true,
      }),
      db.saleItem.aggregate({
        where: {
          sale: { status: 'FINALIZADA', saleDate: { gte: inicioHoje, lte: fimHoje }, ...naUnidade },
        },
        _sum: { quantity: true },
      }),
      db.sale.aggregate({
        where: { status: 'FINALIZADA', saleDate: { gte: inicioHoje, lte: fimHoje }, ...naUnidade },
        _sum: { totalAmount: true, costAmount: true },
      }),
      db.product.findMany({
        where: { id: { in: baixos.map((b) => b.productId) } },
        include: {
          category: true,
          photos: { select: { id: true }, take: 1 },
          stock: { include: { unit: { select: { name: true } } } },
        },
      }),
      db.stock.count({ where: { quantity: 0, ...naUnidade } }),
      db.sale.findMany({
        where: naUnidade,
        orderBy: { saleDate: 'desc' },
        take: 8,
        include: {
          items: { select: { productName: true, quantity: true } },
          seller: { select: { name: true } },
          cashier: { select: { name: true } },
          unit: { select: { name: true } },
        },
      }),
      db.sale.findMany({
        where: { status: 'FINALIZADA', saleDate: { gte: inicioGrafico, lte: fimHoje }, ...naUnidade },
        select: { saleDate: true, totalAmount: true, items: { select: { quantity: true } } },
      }),
      db.stockMovement.findMany({
        where: { createdAt: { gte: inicioGrafico, lte: fimHoje }, ...naUnidade },
        select: { createdAt: true, type: true, quantity: true },
      }),
      db.stock.findMany({
        where: naUnidade,
        select: { quantity: true, product: { select: { categoryId: true } } },
      }),
      db.category.findMany(),
      db.sale.aggregate({
        where: { status: 'FINALIZADA', saleDate: { gte: inicioDoMes }, ...naUnidade },
        _sum: { totalAmount: true, costAmount: true },
      }),
      db.saleItem.aggregate({
        where: { sale: { status: 'FINALIZADA', saleDate: { gte: inicioDoMes }, ...naUnidade } },
        _sum: { quantity: true },
      }),
      valorDoEstoque(unidade),
    ]);

    const dia = (d: Date) => inicioDoDia(d).toISOString().slice(0, 10);

    const baldes = new Map<
      string,
      { date: string; vendas: number; faturamento: number; entradas: number; saidas: number }
    >();

    for (let i = 0; i < dias; i += 1) {
      const chave = dia(somarDias(inicioGrafico, i));
      baldes.set(chave, { date: chave, vendas: 0, faturamento: 0, entradas: 0, saidas: 0 });
    }

    for (const venda of vendasDoPeriodo) {
      const balde = baldes.get(dia(venda.saleDate));
      if (!balde) continue;
      balde.vendas += venda.items.reduce((n, i) => n + i.quantity, 0);
      balde.faturamento += numero(venda.totalAmount);
    }

    for (const mov of movimentosDoPeriodo) {
      const balde = baldes.get(dia(mov.createdAt));
      if (!balde) continue;
      if (mov.type === 'ENTRADA') balde.entradas += mov.quantity;
      if (mov.type === 'SAIDA') balde.saidas += mov.quantity;
    }

    const porCategoria = new Map<string, { quantidade: number; produtos: number }>();
    for (const linha of linhasDeEstoque) {
      const id = linha.product.categoryId;
      const atual = porCategoria.get(id) ?? { quantidade: 0, produtos: 0 };
      atual.quantidade += linha.quantity;
      atual.produtos += 1;
      porCategoria.set(id, atual);
    }

    const receitaHoje = numero(faturamentoHoje._sum?.totalAmount);
    const receitaMes = numero(mes._sum?.totalAmount);

    res.json(
      limpar({
        unitId: unidade ?? null,
        date: inicioHoje.toLocaleDateString('en-CA', { timeZone: FUSO_DA_LOJA }),
        cards: {
          totalProducts: totalProdutos,
          itemsInStock: itensEmEstoque,
          soldToday: itensHoje._sum.quantity ?? 0,
          salesCountToday: vendidosHoje._count,
          revenueToday: receitaHoje,
          profitToday: receitaHoje - numero(faturamentoHoje._sum?.costAmount),
          stockValueCost: valor.custo,
          stockValueSale: valor.venda,
          lowStockCount: baixos.length,
          outOfStockCount: semEstoque,
          revenueMonth: receitaMes,
          profitMonth: receitaMes - numero(mes._sum?.costAmount),
          itemsSoldMonth: itensMes._sum.quantity ?? 0,
          entradas: movimentosDoPeriodo
            .filter((m) => m.type === 'ENTRADA')
            .reduce((s, m) => s + m.quantity, 0),
          saidas: movimentosDoPeriodo
            .filter((m) => m.type === 'SAIDA')
            .reduce((s, m) => s + m.quantity, 0),
        },
        chart: Array.from(baldes.values()),
        categories: Array.from(porCategoria.entries()).map(([id, dados]) => {
          const categoria = categorias.find((c) => c.id === id);
          return {
            categoryId: id,
            name: categoria?.name ?? 'Sem categoria',
            color: categoria?.color ?? '#64748B',
            products: dados.produtos,
            quantity: dados.quantidade,
          };
        }),
        lowStockProducts: produtosBaixos.map((p) => {
          const linha = baixos.find((b) => b.productId === p.id);
          return {
            ...p,
            photos: p.photos.map((f) => `/api/fotos/${f.id}`),
            quantity: linha?.quantity ?? 0,
            unitName: p.stock.find((s) => s.unitId === linha?.unitId)?.unit.name ?? null,
          };
        }),
        latestSales: ultimasVendas,
      }),
    );
  }),
);

/** Alertas do sino — o frontend consulta de minuto em minuto. */
rotasDashboard.get(
  '/alerts',
  rota(async (req, res) => {
    const unidade = unidadePermitida(req.usuario, req.query.unitId as string | undefined);
    const naUnidade = unidade ? { unitId: unidade } : {};

    const baixos = await estoqueBaixo(unidade, 20);

    const [produtos, zerados, vendasHoje, valor] = await Promise.all([
      db.product.findMany({
        where: { id: { in: baixos.map((b) => b.productId) } },
        select: { id: true, name: true, minQuantity: true, model: true },
      }),
      db.stock.findMany({
        where: { quantity: 0, ...naUnidade },
        select: { product: { select: { id: true, name: true, model: true } }, unit: { select: { name: true } } },
        take: 20,
      }),
      db.sale.findMany({
        where: { status: 'FINALIZADA', saleDate: { gte: inicioDoDia(), lte: fimDoDia() }, ...naUnidade },
        select: {
          id: true,
          code: true,
          customerName: true,
          totalAmount: true,
          saleDate: true,
          items: { select: { productName: true, quantity: true } },
          unit: { select: { name: true } },
        },
        orderBy: { saleDate: 'desc' },
      }),
      valorDoEstoque(unidade),
    ]);

    const unidades = await db.unit.findMany({ select: { id: true, name: true } });

    res.json(
      limpar({
        lowStock: baixos.map((b) => {
          const produto = produtos.find((p) => p.id === b.productId);
          return {
            id: b.productId,
            name: produto?.name ?? '—',
            model: produto?.model ?? null,
            quantity: b.quantity,
            minQuantity: b.minQuantity,
            unitName: unidades.find((u) => u.id === b.unitId)?.name ?? null,
          };
        }),
        outOfStock: zerados.map((z) => ({ ...z.product, unitName: z.unit.name })),
        soldToday: vendasHoje,
        soldTodayCount: vendasHoje.reduce((s, v) => s + v.items.reduce((n, i) => n + i.quantity, 0), 0),
        revenueToday: vendasHoje.reduce((s, v) => s + numero(v.totalAmount), 0),
        stockValue: valor.venda,
        updatedAt: new Date().toISOString(),
      }),
    );
  }),
);
