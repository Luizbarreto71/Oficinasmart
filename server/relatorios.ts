import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth';
import {
  AppError,
  PAGAMENTO_LABEL,
  dataBR,
  dataDoFiltro,
  dataHoraCurta,
  fimDoDia,
  intervalo,
  numero,
  rota,
  semVazios,
  validar,
} from './core';
import { exigir } from './permissoes';
import { db } from './db';
import { decimal, exportar, reais, type Coluna } from './exportar';
import { comAsFilhas, MOTIVO_LABEL, STATUS_PRODUTO_LABEL, TIPO_LABEL } from './estoque';
import { unidadePermitida } from './unidades';
import { compararProdutos } from '../shared/ordenar';
import { montarListaDeAtacado } from './lista-atacado';
import { emojisDeCategoria, taxasDoCartao } from './sistema';
import { taxaDe } from '../shared/taxas';

/** Os relatórios, todos exportáveis em PDF, Excel ou CSV. */

export const rotasRelatorios = Router();
rotasRelatorios.use(autenticar, exigir('relatorios'));

const base = z.object({
  format: z.enum(['json', 'pdf', 'xlsx', 'csv']).default('json'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: z.enum(['EM_ESTOQUE', 'RESERVADO', 'VENDIDO']).optional(),
  paymentMethod: z.enum(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']).optional(),
  unitId: z.string().uuid().optional(),
});

type Base = z.infer<typeof base>;

const periodo = (q: Base) => {
  if (!q.startDate && !q.endDate) return 'Período: todos os registros';
  return `Período: ${q.startDate ? dataDoFiltro(q.startDate) : 'início'} até ${q.endDate ? dataDoFiltro(q.endDate) : 'hoje'}`;
};

const money = (header: string, key: string, width = 12): Coluna => ({
  header,
  key,
  width,
  align: 'right',
  format: decimal,
});

const precoDeVenda = (p: { salePrice: unknown; wholesalePrice: unknown }): number =>
  numero(p.salePrice as never) || numero(p.wholesalePrice as never);

const qtd = (header: string, key: string, width = 8): Coluna => ({
  header,
  key,
  width,
  align: 'right',
});

// -------------------------------------------------------- Relatório de estoque

rotasRelatorios.get(
  '/stock',
  rota(async (req, res) => {
    const q = validar(base, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);

    const corte = q.endDate ?? q.startDate ?? null;
    const naData = corte ? fimDoDia(corte) : null;

    const [saldosNaData, comHistorico] = naData
      ? await Promise.all([
          db.$queryRaw<{ productId: string; unitId: string; newQuantity: number }[]>`
            SELECT DISTINCT ON ("productId", "unitId")
                   "productId", "unitId", "newQuantity"
            FROM "stock_movements"
            WHERE "createdAt" <= ${naData}
              AND "productId" IS NOT NULL
              AND "unitId" IS NOT NULL
              AND "newQuantity" IS NOT NULL
            ORDER BY "productId", "unitId", "createdAt" DESC
          `,
          db.stockMovement
            .groupBy({
              by: ['productId', 'unitId'],
              where: { productId: { not: null }, unitId: { not: null } },
            })
            .then((linhas) => new Set(linhas.map((l) => `${l.productId}|${l.unitId}`))),
        ])
      : [null, null];

    const linhasDeEstoque = await db.stock.findMany({
      where: {
        ...(naData ? {} : { quantity: { gt: 0 } }),
        ...(unidade ? { unitId: unidade } : {}),
        product: {
          ...(q.categoryId ? { categoryId: { in: await comAsFilhas(q.categoryId) } } : {}),
          ...(q.supplierId ? { supplierId: q.supplierId } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
      },
      include: {
        unit: { select: { name: true } },
        product: { include: { category: true, supplier: true } },
      },
      orderBy: [{ unit: { name: 'asc' } }, { product: { name: 'asc' } }],
    });

    linhasDeEstoque.sort((a, b) => {
      const porProduto = compararProdutos(a.product, b.product);
      return porProduto !== 0 ? porProduto : a.unit.name.localeCompare(b.unit.name, 'pt-BR');
    });

    const agrupadas = new Map<
      string,
      { product: (typeof linhasDeEstoque)[number]['product']; quantity: number }
    >();

    const saldoDe = (produtoId: string, unidadeId: string, agora: number) => {
      if (!saldosNaData) return agora;

      const achou = saldosNaData.find((m) => m.productId === produtoId && m.unitId === unidadeId);
      if (achou) return Number(achou.newQuantity);

      return comHistorico?.has(`${produtoId}|${unidadeId}`) ? 0 : agora;
    };

    for (const linha of linhasDeEstoque) {
      const quantidade = saldoDe(linha.productId, linha.unitId, linha.quantity);
      if (quantidade <= 0) continue;

      const chave = linha.productId;
      const atual = agrupadas.get(chave);
      if (atual) atual.quantity += quantidade;
      else agrupadas.set(chave, { product: linha.product, quantity: quantidade });
    }

    const linhas = [...agrupadas.values()].map(({ product: p, quantity }) => ({
      name: p.name,
      category: p.category.name,
      brand: p.brand ?? '—',
      tipo: p.tipoControle === 'UNITARIO' ? 'Aparelho' : 'Quantidade',
      quantity,
      costPrice: numero(p.costPrice),
      salePrice: numero(p.salePrice),
      wholesalePrice: p.wholesalePrice != null ? numero(p.wholesalePrice) : null,
      totalCost: numero(p.costPrice) * quantity,
      totalSale: precoDeVenda(p) * quantity,
      supplier: p.supplier?.name ?? '—',
      status: STATUS_PRODUTO_LABEL[p.status] ?? p.status,
      entryDate: dataBR(p.entryDate),
    }));

    const custo = linhas.reduce((s, l) => s + l.totalCost, 0);
    const venda = linhas.reduce((s, l) => s + l.totalSale, 0);

    const nomeDaUnidade = unidade
      ? ((await db.unit.findUnique({ where: { id: unidade }, select: { name: true } }))?.name ?? null)
      : null;

    await exportar(res, q.format, {
      title: 'Relatório de Estoque',
      subtitle: `${nomeDaUnidade ?? 'Todas as unidades'} · ${corte ? `Estoque em ${dataDoFiltro(corte)}` : 'Estoque de hoje'}`,
      group: { key: 'category', totals: ['quantity', 'totalCost', 'totalSale'] },
      columns: [
        { header: 'Produto', key: 'name', width: 26 },
        { header: 'Categoria', key: 'category', width: 14 },
        { header: 'Marca', key: 'brand', width: 12 },
        { header: 'Tipo', key: 'tipo', width: 10 },
        qtd('Qtd', 'quantity', 7),
        money('Custo', 'costPrice', 10),
        money('Venda', 'salePrice', 10),
        {
          header: 'Atacado',
          key: 'wholesalePrice',
          width: 10,
          align: 'right' as const,
          format: (v: unknown) => (v == null ? '—' : decimal(v)),
        },
        money('Total custo', 'totalCost', 12),
        money('Total venda', 'totalSale', 12),
        { header: 'Fornecedor', key: 'supplier', width: 16 },
        { header: 'Status', key: 'status', width: 11 },
      ],
      rows: linhas,
      summary: [
        { label: 'Linhas listadas', value: String(linhas.length) },
        { label: 'Itens em estoque', value: String(linhas.reduce((s, l) => s + l.quantity, 0)) },
        { label: 'Valor total (custo)', value: reais(custo) },
        { label: 'Valor total (venda)', value: reais(venda) },
        { label: 'Lucro potencial', value: reais(venda - custo) },
      ],
    });
  }),
);

// --------------------------------------------------------- Relatório de vendas

rotasRelatorios.get(
  '/sales',
  rota(async (req, res) => {
    const q = validar(base, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const quando = intervalo(q.startDate, q.endDate);

    const itens = await db.saleItem.findMany({
      where: {
        sale: {
          status: 'FINALIZADA',
          ...(quando ? { saleDate: quando } : {}),
          ...(q.paymentMethod ? { paymentMethod: q.paymentMethod } : {}),
          ...(unidade ? { unitId: unidade } : {}),
        },
        ...(q.categoryId ? { product: { categoryId: { in: await comAsFilhas(q.categoryId) } } } : {}),
        ...(q.supplierId ? { product: { supplierId: q.supplierId } } : {}),
      },
      include: {
        product: { include: { category: true } },
        sale: {
          include: {
            seller: { select: { name: true } },
            cashier: { select: { name: true } },
            unit: { select: { name: true } },
            payments: { orderBy: { amount: 'desc' } },
          },
        },
      },
      orderBy: { sale: { saleDate: 'desc' } },
    });

    itens.sort((a, b) => {
      const porProduto = compararProdutos(
        { name: a.productName ?? a.product.name, capacity: a.product.capacity },
        { name: b.productName ?? b.product.name, capacity: b.product.capacity },
      );
      return porProduto !== 0 ? porProduto : b.sale.saleDate.getTime() - a.sale.saleDate.getTime();
    });

    const linhas = itens.map((i) => {
      const total = numero(i.unitPrice) * i.quantity;
      return {
        code: i.sale.code,
        date: dataHoraCurta(i.sale.saleDate),
        unit: i.sale.unit.name,
        customer: i.sale.customerName ?? '—',
        phone: i.sale.customerPhone ?? '—',
        product: i.productName ?? i.product.name,
        category: i.product.category.name,
        imei: i.imei ?? i.serialNumber ?? '—',
        quantity: i.quantity,
        unitPrice: numero(i.unitPrice),
        total,
        profit: total - numero(i.costPrice) * i.quantity,
        payment:
          i.sale.payments.length > 1
            ? i.sale.payments
                .map((p) => `${PAGAMENTO_LABEL[p.method] ?? p.method} ${reais(numero(p.amount))}`)
                .join(' + ')
            : (PAGAMENTO_LABEL[i.sale.paymentMethod] ?? i.sale.paymentMethod),
        installments: i.sale.installments,
        seller: i.sale.seller?.name ?? i.sale.sellerName ?? '—',
        cashier: i.sale.cashier?.name ?? '—',
      };
    });

    const faturamento = linhas.reduce((s, l) => s + l.total, 0);

    await exportar(res, q.format, {
      title: 'Relatório de Vendas',
      subtitle: periodo(q),
      group: { key: 'category', totals: ['quantity', 'total', 'profit'] },
      columns: [
        { header: 'Venda', key: 'code', width: 11 },
        { header: 'Data', key: 'date', width: 13 },
        { header: 'Unidade', key: 'unit', width: 10 },
        { header: 'Cliente', key: 'customer', width: 15 },
        { header: 'Produto', key: 'product', width: 26 },
        { header: 'Categoria', key: 'category', width: 11 },
        { header: 'IMEI / série', key: 'imei', width: 14 },
        qtd('Qtd', 'quantity', 5),
        money('Unit.', 'unitPrice', 11),
        money('Total', 'total', 11),
        money('Lucro', 'profit', 10),
        { header: 'Pagamento', key: 'payment', width: 26 },
        { header: 'Vendedor', key: 'seller', width: 13 },
        { header: 'Caixa', key: 'cashier', width: 11 },
      ],
      rows: linhas,
      summary: [
        { label: 'Vendas realizadas', value: String(linhas.length) },
        { label: 'Itens vendidos', value: String(linhas.reduce((s, l) => s + l.quantity, 0)) },
        { label: 'Faturamento', value: reais(faturamento) },
        { label: 'Lucro bruto', value: reais(linhas.reduce((s, l) => s + l.profit, 0)) },
        { label: 'Ticket médio', value: reais(linhas.length ? faturamento / linhas.length : 0) },
      ],
    });
  }),
);

// ----------------------------------------------------- Relatório por categoria

rotasRelatorios.get(
  '/by-category',
  rota(async (req, res) => {
    const q = validar(base, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const quando = intervalo(q.startDate, q.endDate);

    const [categorias, linhasDeEstoque, vendas] = await Promise.all([
      db.category.findMany({ orderBy: { name: 'asc' } }),
      db.stock.findMany({
        where: unidade ? { unitId: unidade } : {},
        select: {
          quantity: true,
          product: { select: { categoryId: true, costPrice: true, salePrice: true, wholesalePrice: true } },
        },
      }),
      db.saleItem.findMany({
        where: {
          sale: {
            status: 'FINALIZADA',
            ...(quando ? { saleDate: quando } : {}),
            ...(unidade ? { unitId: unidade } : {}),
          },
        },
        select: {
          quantity: true,
          unitPrice: true,
          costPrice: true,
          product: { select: { categoryId: true, supplierId: true } },
        },
      }),
    ]);

    const linhas = categorias.map((c) => {
      const doEstoque = linhasDeEstoque.filter((l) => l.product.categoryId === c.id);
      const daCategoria = vendas.filter((v) => v.product.categoryId === c.id);
      const faturamento = daCategoria.reduce((s, v) => s + numero(v.unitPrice) * v.quantity, 0);
      const custo = daCategoria.reduce((s, v) => s + numero(v.costPrice) * v.quantity, 0);

      return {
        category: c.name,
        products: doEstoque.length,
        stockQty: doEstoque.reduce((s, l) => s + l.quantity, 0),
        stockCost: doEstoque.reduce((s, l) => s + numero(l.product.costPrice) * l.quantity, 0),
        stockSale: doEstoque.reduce((s, l) => s + precoDeVenda(l.product) * l.quantity, 0),
        soldQty: daCategoria.reduce((s, v) => s + v.quantity, 0),
        revenue: faturamento,
        profit: faturamento - custo,
      };
    });

    await exportar(res, q.format, {
      title: 'Relatório por Categoria',
      subtitle: periodo(q),
      columns: [
        { header: 'Categoria', key: 'category', width: 22 },
        qtd('Produtos', 'products', 10),
        qtd('Em estoque', 'stockQty', 10),
        money('Estoque (custo)', 'stockCost', 14),
        money('Estoque (venda)', 'stockSale', 14),
        qtd('Vendidos', 'soldQty', 10),
        money('Faturamento', 'revenue', 14),
        money('Lucro', 'profit', 13),
      ],
      rows: linhas,
      summary: [
        { label: 'Faturamento total', value: reais(linhas.reduce((s, l) => s + l.revenue, 0)) },
        { label: 'Lucro total', value: reais(linhas.reduce((s, l) => s + l.profit, 0)) },
        { label: 'Valor em estoque (custo)', value: reais(linhas.reduce((s, l) => s + l.stockCost, 0)) },
      ],
    });
  }),
);

// ---------------------------------------------------- Relatório por fornecedor

rotasRelatorios.get(
  '/by-supplier',
  rota(async (req, res) => {
    const q = validar(base, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const quando = intervalo(q.startDate, q.endDate);

    const [fornecedores, linhasDeEstoque, vendas] = await Promise.all([
      db.supplier.findMany({ orderBy: { name: 'asc' } }),
      db.stock.findMany({
        where: unidade ? { unitId: unidade } : {},
        select: { quantity: true, product: { select: { supplierId: true, costPrice: true } } },
      }),
      db.saleItem.findMany({
        where: {
          sale: {
            status: 'FINALIZADA',
            ...(quando ? { saleDate: quando } : {}),
            ...(unidade ? { unitId: unidade } : {}),
          },
        },
        select: {
          quantity: true,
          unitPrice: true,
          costPrice: true,
          product: { select: { categoryId: true, supplierId: true } },
        },
      }),
    ]);

    const linhas = fornecedores.map((f) => {
      const doEstoque = linhasDeEstoque.filter((l) => l.product.supplierId === f.id);
      const doFornecedor = vendas.filter((v) => v.product.supplierId === f.id);
      const faturamento = doFornecedor.reduce((s, v) => s + numero(v.unitPrice) * v.quantity, 0);
      const custo = doFornecedor.reduce((s, v) => s + numero(v.costPrice) * v.quantity, 0);

      return {
        supplier: f.name,
        active: f.active ? 'Sim' : 'Não',
        products: doEstoque.length,
        stockQty: doEstoque.reduce((s, l) => s + l.quantity, 0),
        invested: doEstoque.reduce((s, l) => s + numero(l.product.costPrice) * l.quantity, 0),
        soldQty: doFornecedor.reduce((s, v) => s + v.quantity, 0),
        revenue: faturamento,
        profit: faturamento - custo,
      };
    });

    await exportar(res, q.format, {
      title: 'Relatório por Fornecedor',
      subtitle: periodo(q),
      columns: [
        { header: 'Fornecedor', key: 'supplier', width: 24 },
        { header: 'Ativo', key: 'active', width: 8, align: 'center' },
        qtd('Produtos', 'products', 10),
        qtd('Em estoque', 'stockQty', 11),
        money('Investido', 'invested', 14),
        qtd('Vendidos', 'soldQty', 10),
        money('Faturamento', 'revenue', 14),
        money('Lucro', 'profit', 13),
      ],
      rows: linhas,
      summary: [
        { label: 'Fornecedores', value: String(linhas.length) },
        { label: 'Total investido', value: reais(linhas.reduce((s, l) => s + l.invested, 0)) },
        { label: 'Faturamento', value: reais(linhas.reduce((s, l) => s + l.revenue, 0)) },
      ],
    });
  }),
);

// ------------------------------------------------------- Relatório por período

rotasRelatorios.get(
  '/by-period',
  rota(async (req, res) => {
    const q = validar(base.extend({ groupBy: z.enum(['day', 'month']).default('day') }), req.query);
    const quando = intervalo(q.startDate, q.endDate);

    const [vendas, movimentos] = await Promise.all([
      db.saleItem.findMany({
        where: { sale: { status: 'FINALIZADA', ...(quando ? { saleDate: quando } : {}) } },
        select: { quantity: true, unitPrice: true, costPrice: true, sale: { select: { saleDate: true } } },
      }),
      db.stockMovement.findMany({
        where: quando ? { createdAt: quando } : {},
        select: { createdAt: true, type: true, quantity: true },
      }),
    ]);

    const chave = (d: Date) =>
      q.groupBy === 'month'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : d.toISOString().slice(0, 10);

    const mapa = new Map<
      string,
      { period: string; sales: number; quantity: number; revenue: number; profit: number; entries: number; exits: number }
    >();

    const balde = (k: string) => {
      if (!mapa.has(k)) {
        mapa.set(k, { period: k, sales: 0, quantity: 0, revenue: 0, profit: 0, entries: 0, exits: 0 });
      }
      return mapa.get(k)!;
    };

    for (const v of vendas) {
      const b = balde(chave(v.sale.saleDate));
      const total = numero(v.unitPrice) * v.quantity;
      b.quantity += v.quantity;
      b.revenue += total;
      b.profit += total - numero(v.costPrice) * v.quantity;
    }

    for (const m of movimentos) {
      const b = balde(chave(m.createdAt));
      if (m.type === 'ENTRADA') b.entries += m.quantity;
      if (m.type === 'SAIDA') b.exits += m.quantity;
    }

    const linhas = Array.from(mapa.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((l) => ({
        ...l,
        periodLabel:
          q.groupBy === 'month'
            ? l.period.split('-').reverse().join('/')
            : dataBR(new Date(`${l.period}T12:00:00`)),
      }));

    await exportar(res, q.format, {
      title: 'Relatório por Período',
      subtitle: periodo(q),
      columns: [
        { header: q.groupBy === 'month' ? 'Mês' : 'Dia', key: 'periodLabel', width: 12 },
        qtd('Vendas', 'sales', 9),
        qtd('Itens', 'quantity', 9),
        money('Faturamento', 'revenue', 14),
        money('Lucro', 'profit', 13),
        qtd('Entradas', 'entries', 10),
        qtd('Saídas', 'exits', 10),
      ],
      rows: linhas,
      summary: [
        { label: 'Faturamento total', value: reais(linhas.reduce((s, l) => s + l.revenue, 0)) },
        { label: 'Lucro total', value: reais(linhas.reduce((s, l) => s + l.profit, 0)) },
        { label: 'Itens vendidos', value: String(linhas.reduce((s, l) => s + l.quantity, 0)) },
      ],
    });
  }),
);

// -------------------------------------------------- Relatório de movimentações

rotasRelatorios.get(
  '/movements',
  rota(async (req, res) => {
    const q = validar(
      base.extend({ type: z.enum(['ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE']).optional() }),
      req.query,
    );
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const quando = intervalo(q.startDate, q.endDate);

    const movimentos = await db.stockMovement.findMany({
      where: {
        ...(quando ? { createdAt: quando } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(unidade ? { unitId: unidade } : {}),
        ...(q.categoryId ? { product: { categoryId: { in: await comAsFilhas(q.categoryId) } } } : {}),
      },
      include: {
        user: { select: { name: true } },
        unit: { select: { name: true } },
        product: { select: { model: true, category: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const unidades = await db.unit.findMany({ select: { id: true, name: true } });
    const nome = (id?: string | null) => unidades.find((u) => u.id === id)?.name ?? '—';

    const linhas = movimentos.map((m) => ({
      date: dataHoraCurta(m.createdAt),
      unit: m.unit?.name ?? '—',
      type: TIPO_LABEL[m.type] ?? m.type,
      reason: MOTIVO_LABEL[m.reason] ?? m.reason,
      product: m.productName ?? '—',
      category: m.product?.category.name ?? '—',
      quantity: m.type === 'ENTRADA' ? m.quantity : -m.quantity,
      previous: m.previousQuantity ?? '—',
      balance: m.newQuantity ?? '—',
      origin: m.originUnitId ? nome(m.originUnitId) : '—',
      destination: m.destinationUnitId ? nome(m.destinationUnitId) : '—',
      user: m.user?.name ?? '—',
      notes: m.notes ?? '—',
    }));

    const somaPor = (tipo: string) =>
      movimentos.filter((m) => m.type === tipo).reduce((s, m) => s + m.quantity, 0);

    await exportar(res, q.format, {
      title: 'Relatório de Movimentações',
      subtitle: periodo(q),
      columns: [
        { header: 'Data', key: 'date', width: 15 },
        { header: 'Unidade', key: 'unit', width: 11 },
        { header: 'Tipo', key: 'type', width: 11 },
        { header: 'Motivo', key: 'reason', width: 15 },
        { header: 'Produto', key: 'product', width: 22 },
        { header: 'Categoria', key: 'category', width: 12 },
        qtd('Qtd', 'quantity', 6),
        qtd('Antes', 'previous', 7),
        qtd('Depois', 'balance', 7),
        { header: 'Origem', key: 'origin', width: 11 },
        { header: 'Destino', key: 'destination', width: 11 },
        { header: 'Usuário', key: 'user', width: 13 },
      ],
      rows: linhas,
      summary: [
        { label: 'Movimentações', value: String(linhas.length) },
        { label: 'Entradas', value: String(somaPor('ENTRADA')) },
        { label: 'Saídas', value: String(somaPor('SAIDA')) },
        { label: 'Transferências', value: String(somaPor('TRANSFERENCIA')) },
      ],
    });
  }),
);

// -------------------------------------------- Relatório por forma de pagamento

rotasRelatorios.get(
  '/by-payment',
  rota(async (req, res) => {
    const q = validar(base, semVazios(req.query));
    const unidade = unidadePermitida(req.usuario, q.unitId);
    const quando = intervalo(q.startDate, q.endDate);

    const pagamentos = await db.salePayment.findMany({
      where: {
        sale: {
          status: 'FINALIZADA',
          ...(quando ? { saleDate: quando } : {}),
          ...(unidade ? { unitId: unidade } : {}),
        },
      },
      select: {
        method: true,
        amount: true,
        installments: true,
        saleId: true,
        feePercent: true,
        netAmount: true,
        settledAt: true,
        destino: true,
      },
    });

    const tabela = await taxasDoCartao();

    const liquidoDe = (p: (typeof pagamentos)[number]) => {
      if (p.netAmount != null) return numero(p.netAmount);
      if (p.method === 'EM_ABERTO') return p.settledAt ? numero(p.amount) : 0;
      if (p.method !== 'CREDITO') return numero(p.amount);

      const taxa = taxaDe(tabela, p.installments, 'padrao');
      return taxa != null ? numero(p.amount) * (1 - taxa / 100) : numero(p.amount);
    };

    const total = pagamentos.reduce((s, p) => s + numero(p.amount), 0);

    const chaves = [
      ...new Set(
        pagamentos.map((p) => (p.method === 'PIX' && p.destino ? `PIX::${p.destino}` : p.method)),
      ),
    ];
    const ordem = Object.keys(PAGAMENTO_LABEL);
    chaves.sort((a, b) => ordem.indexOf(a.split('::')[0]) - ordem.indexOf(b.split('::')[0]));

    const linhas = chaves
      .map((chave) => {
        const [forma, conta] = chave.split('::');
        const daForma = pagamentos.filter(
          (p) => p.method === forma && (conta ? p.destino === conta : !(forma === 'PIX' && p.destino)),
        );
        const soma = daForma.reduce((s, p) => s + numero(p.amount), 0);
        const vendas = new Set(daForma.map((p) => p.saleId)).size;
        const parceladas = daForma.filter((p) => p.installments > 1);
        const liquido = daForma.reduce((s, p) => s + liquidoDe(p), 0);
        const taxa = daForma.reduce(
          (s, p) => s + (p.method === 'CREDITO' ? numero(p.amount) - liquidoDe(p) : 0),
          0,
        );
        const aReceber = daForma.reduce(
          (s, p) => s + (p.method === 'EM_ABERTO' && !p.settledAt ? numero(p.amount) : 0),
          0,
        );

        return {
          payment: conta ?? PAGAMENTO_LABEL[forma],
          sales: vendas,
          lancamentos: daForma.length,
          total: soma,
          taxa,
          aReceber,
          liquido,
          share: total > 0 ? (soma / total) * 100 : 0,
          ticket: vendas > 0 ? soma / vendas : 0,
          parcelado: parceladas.length
            ? `${parceladas.length} em até ${Math.max(...parceladas.map((p) => p.installments))}x`
            : '—',
        };
      })
      .filter((l) => l.lancamentos > 0);

    const emDinheiro = linhas.filter((l) => l.payment !== PAGAMENTO_LABEL.TROCA);

    await exportar(res, q.format, {
      title: 'Vendas por Forma de Pagamento',
      subtitle: periodo(q),
      columns: [
        { header: 'Forma de pagamento', key: 'payment', width: 22 },
        qtd('Vendas', 'sales', 10),
        qtd('Lançamentos', 'lancamentos', 12),
        money('Total', 'total', 15),
        money('Taxa da maquininha', 'taxa', 14),
        money('A receber', 'aReceber', 13),
        money('Na conta', 'liquido', 14),
        { header: '% do total', key: 'share', width: 10, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
        money('Ticket médio', 'ticket', 13),
        { header: 'Parcelados', key: 'parcelado', width: 13 },
      ],
      rows: linhas,
      summary: [
        { label: 'Formas usadas', value: String(linhas.length) },
        { label: 'Vendido em dinheiro', value: reais(emDinheiro.reduce((s, l) => s + l.total, 0)) },
        { label: 'Taxa da maquininha', value: reais(linhas.reduce((s, l) => s + l.taxa, 0)) },
        { label: 'Ainda a receber', value: reais(linhas.reduce((s, l) => s + l.aReceber, 0)) },
        { label: 'Já está na conta', value: reais(emDinheiro.reduce((s, l) => s + l.liquido, 0)) },
        { label: 'Movimentado', value: reais(total) },
      ],
    });
  }),
);

// ------------------------------------------------- Tabela de preços do vendedor

rotasRelatorios.get(
  '/price-list',
  exigir('financeiro'),
  rota(async (req, res) => {
    const q = validar(
      base.extend({
        markup: z.coerce.number().min(0).max(999_999).default(100),
        incluirCusto: z.enum(['true', 'false']).default('false'),
        somenteComEstoque: z.enum(['true', 'false']).default('true'),
      }),
      semVazios(req.query),
    );

    const unidade = unidadePermitida(req.usuario, q.unitId);
    const mostrarCusto = q.incluirCusto === 'true';

    const produtos = await db.product.findMany({
      where: {
        ...(q.categoryId ? { categoryId: { in: await comAsFilhas(q.categoryId) } } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.somenteComEstoque === 'true'
          ? { stock: { some: { quantity: { gt: 0 }, ...(unidade ? { unitId: unidade } : {}) } } }
          : {}),
      },
      include: {
        category: true,
        stock: unidade ? { where: { unitId: unidade } } : true,
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });

    produtos.sort(
      (a, b) => a.category.name.localeCompare(b.category.name, 'pt-BR') || compararProdutos(a, b),
    );

    const linhas = produtos.map((p) => {
      const custo = numero(p.costPrice);
      const emEstoque = p.stock.reduce((soma, l) => soma + l.quantity, 0);

      return {
        category: p.category.name,
        name: p.name,
        detalhe: [p.brand, p.model].filter(Boolean).join(' ') || '—',
        categoria: p.category.name,
        capacidade: p.capacity ?? '—',
        quantity: emEstoque,
        custo,
        preco: custo + q.markup,
      };
    });

    const colunas: Coluna[] = [
      { header: 'Categoria', key: 'category', width: 14 },
      { header: 'Produto', key: 'name', width: 26 },
      { header: 'Marca / modelo', key: 'detalhe', width: 16 },
      { header: 'Capacidade', key: 'capacidade', width: 12 },
      qtd('Estoque', 'quantity', 8),
      ...(mostrarCusto ? [money('Custo', 'custo', 11)] : []),
      money('PREÇO DE VENDA', 'preco', 14),
    ];

    await exportar(res, q.format, {
      title: 'Tabela de Preços',
      subtitle:
        `Preço = custo + ${reais(q.markup)}` +
        (unidade ? ` · estoque da unidade selecionada` : '') +
        (mostrarCusto ? ' · CONTÉM O CUSTO — uso interno' : ' · não mostra o preço de compra'),
      columns: colunas,
      rows: linhas,
      summary: [
        { label: 'Produtos na lista', value: String(linhas.length) },
        { label: 'Peças em estoque', value: String(linhas.reduce((s, l) => s + l.quantity, 0)) },
        { label: 'Acréscimo aplicado', value: reais(q.markup) },
      ],
    });
  }),
);

// ------------------------------------------------ Lista para o WhatsApp

rotasRelatorios.get(
  '/whatsapp-list',
  rota(async (req, res) => {
    const q = validar(
      z.object({
        categoryId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        somenteDisponiveis: z.enum(['true', 'false']).default('true'),
      }),
      semVazios(req.query),
    );

    const unidade = unidadePermitida(req.usuario, q.unitId);
    const somenteDisponiveis = q.somenteDisponiveis === 'true';

    const produtos = await db.product.findMany({
      where: {
        ...(q.categoryId ? { categoryId: { in: await comAsFilhas(q.categoryId) } } : {}),
        wholesalePrice: { not: null },
        status: 'EM_ESTOQUE',
        ...(somenteDisponiveis
          ? { stock: { some: { quantity: { gt: 0 }, ...(unidade ? { unitId: unidade } : {}) } } }
          : unidade
            ? { stock: { some: { unitId: unidade } } }
            : {}),
      },
      include: { category: { select: { id: true, name: true, ordem: true } } },
    });

    const { texto, resumo } = montarListaDeAtacado(
      produtos.map((p) => ({
        name: p.name,
        capacity: p.capacity,
        atacado: numero(p.wholesalePrice),
        categoriaId: p.category.id,
        categoriaNome: p.category.name,
        categoriaOrdem: p.category.ordem,
      })),
      await emojisDeCategoria(),
    );

    res.json({ texto, resumo });
  }),
);
