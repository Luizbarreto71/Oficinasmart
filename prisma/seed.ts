import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { camposParaJson, PADRAO_GENERICO, PADROES } from '../shared/campos';

dotenv.config();

const db = new PrismaClient();

/**
 * Prepara o banco para uso.
 *
 *   npm run db:seed        → unidades + categorias (banco limpo, pronto para a loja)
 *   npm run db:exemplos    → também cria produtos e uma venda de demonstração
 *
 * O administrador é criado com `npm run criar-admin`.
 */
const criarExemplos = process.argv.includes('--exemplos');

/** As duas unidades. Sem elas não há onde guardar estoque. */
const UNIDADES = [
  { name: 'Loja', type: 'MATRIZ' },
  { name: 'Estoque', type: 'FILIAL' },
];

const CATEGORIAS: {
  name: string;
  slug: string;
  color: string;
  tipoControlePadrao: 'UNITARIO' | 'QUANTIDADE';
  ordem: number;
}[] = [
  { name: 'Smartphones', slug: 'smartphones', color: '#2563EB', tipoControlePadrao: 'UNITARIO', ordem: 1 },
  { name: 'Acessórios', slug: 'acessorios', color: '#16A34A', tipoControlePadrao: 'QUANTIDADE', ordem: 2 },
  { name: 'Peças', slug: 'pecas', color: '#F97316', tipoControlePadrao: 'QUANTIDADE', ordem: 3 },
  { name: 'Serviços', slug: 'servicos', color: '#8B5CF6', tipoControlePadrao: 'QUANTIDADE', ordem: 4 },
  { name: 'Seminovos', slug: 'seminovos', color: '#F59E0B', tipoControlePadrao: 'UNITARIO', ordem: 5 },
  { name: 'Outros', slug: 'outros', color: '#64748B', tipoControlePadrao: 'QUANTIDADE', ordem: 6 },
];

async function main() {
  console.log('🌱 Preparando o banco...');

  for (const unidade of UNIDADES) {
    await db.unit.upsert({
      where: { name: unidade.name },
      update: { type: unidade.type },
      create: unidade,
    });
  }
  console.log(`✅ ${UNIDADES.length} unidades: ${UNIDADES.map((u) => u.name).join(', ')}`);

  for (const categoria of CATEGORIAS) {
    const padrao = camposParaJson(PADROES[categoria.slug] ?? PADRAO_GENERICO);
    const existente = await db.category.findUnique({ where: { slug: categoria.slug } });

    await db.category.upsert({
      where: { slug: categoria.slug },
      update: {
        name: categoria.name,
        color: categoria.color,
        ordem: categoria.ordem,
        tipoControlePadrao: categoria.tipoControlePadrao,
        ...(existente?.campos ? {} : { campos: padrao }),
      },
      create: {
        name: categoria.name,
        slug: categoria.slug,
        color: categoria.color,
        ordem: categoria.ordem,
        tipoControlePadrao: categoria.tipoControlePadrao,
        campos: padrao,
      },
    });
  }
  console.log(`✅ ${CATEGORIAS.length} categorias com seus formulários`);

  // A unidade de venda padrão é a Loja.
  const loja = await db.unit.findUnique({ where: { name: 'Loja' } });
  if (loja) {
    await db.setting.upsert({
      where: { key: 'unidade_de_venda' },
      update: {},
      create: { key: 'unidade_de_venda', value: loja.id },
    });
  }

  const usuarios = await db.user.count();
  if (usuarios === 0) {
    console.log('\n⚠️  Ainda não existe nenhum usuário. Crie o administrador com:');
    console.log('   npm run criar-admin -- "Nome do Dono" email@dominio.com\n');
  } else {
    console.log(`✅ ${usuarios} usuário(s) já cadastrados`);
  }

  if (!criarExemplos) {
    console.log('🎉 Banco pronto para uso.');
    return;
  }

  if ((await db.product.count()) > 0) {
    console.log('ℹ️  Já existem produtos — pulando os dados de exemplo.');
    return;
  }

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' } });
  const lojaU = await db.unit.findUniqueOrThrow({ where: { name: 'Loja' } });
  const estoqueU = await db.unit.findUniqueOrThrow({ where: { name: 'Estoque' } });

  const fornecedores = await Promise.all(
    [
      { name: 'Distribuidora Tech', phone: '(11) 98888-1111' },
      { name: 'Acessórios Import', phone: '(11) 97777-2222' },
      { name: 'Peças & Cia', phone: '(11) 96666-3333' },
    ].map((f) => db.supplier.create({ data: f })),
  );

  const categorias = await db.category.findMany();
  const id = (slug: string) => categorias.find((c) => c.slug === slug)!.id;

  // --- Smartphones (UNITARIO): 1 produto, 3 aparelhos com IMEI
  const iphone = await db.product.create({
    data: {
      name: 'iPhone 13 128GB',
      brand: 'Apple',
      model: '13',
      color: 'Meia-noite',
      capacity: '128GB',
      tipoControle: 'UNITARIO',
      minQuantity: 1,
      costPrice: 2800,
      salePrice: 3699,
      wholesalePrice: 3500,
      garantiaPadraoDias: 90,
      categoryId: id('smartphones'),
      supplierId: fornecedores[0].id,
    },
  });
  const imeis = ['356938035643809', '351756051523999', '353247104765432'];
  for (let k = 0; k < imeis.length; k += 1) {
    await db.deviceUnit.create({
      data: {
        productId: iphone.id,
        unitId: k === 0 ? lojaU.id : estoqueU.id,
        imei: imeis[k],
        condicao: 'Novo / Lacrado',
        batteryHealth: 100,
        costPrice: 2800,
        status: 'EM_ESTOQUE',
      },
    });
  }
  await db.stock.createMany({
    data: [
      { productId: iphone.id, unitId: lojaU.id, quantity: 1 },
      { productId: iphone.id, unitId: estoqueU.id, quantity: 2 },
    ],
  });
  for (const [unidade, q] of [
    [lojaU.id, 1],
    [estoqueU.id, 2],
  ] as const) {
    await db.stockMovement.create({
      data: {
        type: 'ENTRADA',
        reason: 'CADASTRO',
        quantity: q,
        previousQuantity: 0,
        newQuantity: q,
        productId: iphone.id,
        productName: iphone.name,
        unitId: unidade,
        userId: admin?.id ?? null,
        notes: 'Carga inicial de exemplo',
      },
    });
  }

  // --- Acessórios (QUANTIDADE)
  const acessorios = [
    { dados: { name: 'Película 3D iPhone 13', brand: 'Genérica', model: '13', minQuantity: 5, costPrice: 4, salePrice: 25, wholesalePrice: 15, barcode: '7890000000017', categoryId: id('acessorios'), supplierId: fornecedores[1].id }, loja: 40, estoque: 20 },
    { dados: { name: 'Carregador USB-C 20W', brand: 'Genérica', model: '20W', minQuantity: 3, costPrice: 22, salePrice: 69, wholesalePrice: 45, categoryId: id('acessorios'), supplierId: fornecedores[1].id }, loja: 12, estoque: 8 },
    { dados: { name: 'Capa silicone iPhone 13', brand: 'Genérica', model: '13', color: 'Preto', minQuantity: 4, costPrice: 8, salePrice: 39, wholesalePrice: 22, categoryId: id('acessorios'), supplierId: fornecedores[1].id }, loja: 25, estoque: 10 },
  ];
  for (const { dados, loja: naLoja, estoque: noEstoque } of acessorios) {
    const produto = await db.product.create({ data: { ...dados, tipoControle: 'QUANTIDADE' } });
    for (const [unidade, quantidade] of [
      [lojaU.id, naLoja],
      [estoqueU.id, noEstoque],
    ] as const) {
      await db.stock.create({ data: { productId: produto.id, unitId: unidade, quantity: quantidade } });
      await db.stockMovement.create({
        data: {
          type: 'ENTRADA',
          reason: 'CADASTRO',
          quantity: quantidade,
          previousQuantity: 0,
          newQuantity: quantidade,
          productId: produto.id,
          productName: produto.name,
          unitId: unidade,
          userId: admin?.id ?? null,
          notes: 'Carga inicial de exemplo',
        },
      });
    }
  }

  // --- Peça
  const pecaTela = await db.product.create({
    data: {
      name: 'Tela iPhone 13 (Incell)',
      model: 'iPhone 13',
      condicao: 'Incell',
      tipoControle: 'QUANTIDADE',
      minQuantity: 2,
      costPrice: 180,
      salePrice: 450,
      categoryId: id('pecas'),
      supplierId: fornecedores[2].id,
    },
  });
  await db.stock.create({ data: { productId: pecaTela.id, unitId: estoqueU.id, quantity: 5 } });
  await db.stockMovement.create({
    data: {
      type: 'ENTRADA', reason: 'CADASTRO', quantity: 5, previousQuantity: 0, newQuantity: 5,
      productId: pecaTela.id, productName: pecaTela.name, unitId: estoqueU.id, userId: admin?.id ?? null,
      notes: 'Carga inicial de exemplo',
    },
  });

  // --- Serviço (sem estoque)
  await db.product.create({
    data: {
      name: 'Troca de tela iPhone 13',
      tipoControle: 'QUANTIDADE',
      semEstoque: true,
      costPrice: 180,
      salePrice: 650,
      categoryId: id('servicos'),
    },
  });

  console.log('✅ produtos de exemplo (smartphone com IMEI, acessórios, peça, serviço)');

  // Uma venda de demonstração: a película, à vista no Pix.
  const pelicula = await db.product.findFirst({ where: { name: { contains: 'Película' } } });
  if (pelicula && admin) {
    const cliente = await db.customer.create({
      data: { name: 'Maria Silva', phone: '(11) 98123-4567' },
    });
    const venda = await db.sale.create({
      data: {
        code: 'VD-000001',
        totalAmount: 25,
        costAmount: 4,
        paymentMethod: 'PIX',
        unitId: lojaU.id,
        customerId: cliente.id,
        customerName: cliente.name,
        customerPhone: cliente.phone,
        sellerId: admin.id,
        cashierId: admin.id,
        notes: 'Venda de demonstração',
        items: {
          create: {
            productId: pelicula.id,
            productName: pelicula.name,
            quantity: 1,
            unitPrice: 25,
            costPrice: 4,
          },
        },
        payments: { create: { method: 'PIX', amount: 25, netAmount: 25 } },
      },
    });

    const linha = await db.stock.update({
      where: { productId_unitId: { productId: pelicula.id, unitId: lojaU.id } },
      data: { quantity: { decrement: 1 } },
    });

    await db.stockMovement.create({
      data: {
        type: 'SAIDA',
        reason: 'VENDA',
        quantity: 1,
        previousQuantity: linha.quantity + 1,
        newQuantity: linha.quantity,
        productId: pelicula.id,
        productName: pelicula.name,
        unitId: lojaU.id,
        saleId: venda.id,
        userId: admin.id,
      },
    });
    console.log('✅ 1 venda de demonstração');
  }

  console.log('🎉 Pronto!');
}

main()
  .catch((erro) => {
    console.error('❌ Erro no seed:', erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
