import { PaymentMethod, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar } from './auth.js';
import {
  AppError,
  contem,
  intervalo,
  limpar,
  naoEncontrado,
  numero,
  paginacao,
  paginado,
  rota,
  semVazios,
  somarDias,
  validar,
} from './core.js';
import { db, registrarLog } from './db.js';
import { disponivel, movimentar } from './estoque.js';
import { notificar, notificarPerfil } from './notificacoes.js';
import { exigir } from './permissoes.js';
import { comprovanteDeOS } from './recibo-os.js';
import { lojaSalva, taxasDoCartao, unidadeDeVenda } from './sistema.js';
import { unidadePermitida } from './unidades.js';
import { proximoCodigo } from './vendas-service.js';
import { taxaDe, type TaxaDeCartao } from '../shared/taxas.js';

/**
 * Ordem de Serviço (assistência técnica).
 *
 * O fluxo: RECEBIDO → EM_ANALISE → ORCAMENTO → APROVADO → EM_REPARO →
 * PRONTO → ENTREGUE. A entrega gera uma venda (VD-…): as peças `kind=PECA`
 * baixam do estoque com motivo REPARO e a mão de obra entra como item de
 * serviço. Assim o faturamento do conserto aparece sozinho no caixa, no
 * dashboard e nos relatórios, junto com as vendas de balcão.
 *
 * Reaproveita `movimentar()`, `proximoCodigo()`, a tabela de taxas do cartão,
 * as notificações e o comprovante em PDF.
 */

export const rotasOrdens = Router();
rotasOrdens.use(autenticar);

const STATUS = [
  'RECEBIDO',
  'EM_ANALISE',
  'ORCAMENTO',
  'APROVADO',
  'EM_REPARO',
  'AGUARDANDO_PECA',
  'PRONTO',
  'ENTREGUE',
  'RECUSADO',
  'CANCELADO',
] as const;
type Status = (typeof STATUS)[number];

/** Status que ainda contam como "OS aberta" (trabalho em andamento). */
const ABERTOS: Status[] = [
  'RECEBIDO',
  'EM_ANALISE',
  'ORCAMENTO',
  'APROVADO',
  'EM_REPARO',
  'AGUARDANDO_PECA',
  'PRONTO',
];

/** Transições permitidas pela rota genérica `/:id/status`. */
const TRANSICOES: Record<string, Status[]> = {
  RECEBIDO: ['EM_ANALISE', 'ORCAMENTO'],
  EM_ANALISE: ['ORCAMENTO', 'RECEBIDO'],
  ORCAMENTO: ['EM_ANALISE'],
  APROVADO: ['EM_REPARO', 'AGUARDANDO_PECA', 'PRONTO'],
  EM_REPARO: ['AGUARDANDO_PECA', 'PRONTO'],
  AGUARDANDO_PECA: ['EM_REPARO', 'PRONTO'],
  PRONTO: ['EM_REPARO'],
};

/** Status a partir dos quais a entrega (com orçamento aprovado) é possível. */
const PODE_ENTREGAR: Status[] = ['APROVADO', 'EM_REPARO', 'AGUARDANDO_PECA', 'PRONTO'];

const STATUS_LABEL: Record<Status, string> = {
  RECEBIDO: 'Recebido',
  EM_ANALISE: 'Em análise',
  ORCAMENTO: 'Orçamento enviado',
  APROVADO: 'Aprovado',
  EM_REPARO: 'Em reparo',
  AGUARDANDO_PECA: 'Aguardando peça',
  PRONTO: 'Pronto para retirada',
  ENTREGUE: 'Entregue',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

const PAGAMENTOS = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'EM_ABERTO', 'OUTRO'] as const;

const COM_TUDO = {
  items: { orderBy: [{ kind: 'asc' }, { description: 'asc' }] as const },
  photos: {
    select: { id: true, tipo: true, createdAt: true },
    orderBy: { createdAt: 'asc' } as const,
  },
  customer: { select: { id: true, name: true, phone: true, document: true } },
  technician: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  sale: { select: { id: true, code: true, totalAmount: true } },
} satisfies Prisma.ServiceOrderInclude;

type OrdemCompleta = Prisma.ServiceOrderGetPayload<{ include: typeof COM_TUDO }>;

const paraJson = (os: OrdemCompleta) => ({
  ...limpar(os),
  statusLabel: STATUS_LABEL[os.status as Status] ?? os.status,
  aberta: ABERTOS.includes(os.status as Status),
  photos: os.photos.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    url: `/api/service-orders/fotos/${f.id}`,
  })),
});

// ------------------------------------------------------------------ Fotos

const fotoSchema = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA']).default('ENTRADA'),
  data: z.string().max(4_000_000),
});

function separarFotos(
  fotos: z.infer<typeof fotoSchema>[] | undefined,
  tipoPadrao: 'ENTRADA' | 'SAIDA',
) {
  return (fotos ?? []).flatMap((f) => {
    const m = f.data.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return [];
    return [{ tipo: f.tipo ?? tipoPadrao, mimeType: m[1], data: Buffer.from(m[2], 'base64') }];
  });
}

/** Objeto JSON pronto para o Prisma, ou o sentinel de NULL. */
const checklistParaBanco = (
  valor: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  valor == null ? Prisma.JsonNull : (valor as Prisma.InputJsonValue);

// --------------------------------------------------- Produto de mão de obra

const CHAVE_PRODUTO_SERVICO = 'os_produto_servico_id';

/**
 * Todo item de mão de obra vira uma linha de venda — e `SaleItem` exige um
 * produto. Este é um produto interno "sem estoque" que representa o serviço
 * técnico. Criado sozinho na primeira entrega e reaproveitado depois.
 */
async function produtoDeServico(
  tx: Prisma.TransactionClient,
): Promise<{ id: string; costPrice: Prisma.Decimal }> {
  const salvo = await tx.setting.findUnique({ where: { key: CHAVE_PRODUTO_SERVICO } });
  if (salvo) {
    const existente = await tx.product.findUnique({
      where: { id: salvo.value },
      select: { id: true, costPrice: true },
    });
    if (existente) return existente;
  }

  const categoria =
    (await tx.category.findUnique({ where: { slug: 'servicos' }, select: { id: true } })) ??
    (await tx.category.findFirst({ orderBy: { ordem: 'asc' }, select: { id: true } }));
  if (!categoria) {
    throw new AppError('Cadastre ao menos uma categoria antes de entregar uma OS.', 500);
  }

  const jaExiste = await tx.product.findFirst({
    where: { name: 'Serviço técnico (OS)', categoryId: categoria.id },
    select: { id: true, costPrice: true },
  });

  const produto =
    jaExiste ??
    (await tx.product.create({
      data: {
        name: 'Serviço técnico (OS)',
        tipoControle: 'QUANTIDADE',
        semEstoque: true,
        categoryId: categoria.id,
        notes:
          'Produto interno: representa a mão de obra das Ordens de Serviço nas vendas. Não editar.',
      },
      select: { id: true, costPrice: true },
    }));

  await tx.setting.upsert({
    where: { key: CHAVE_PRODUTO_SERVICO },
    update: { value: produto.id },
    create: { key: CHAVE_PRODUTO_SERVICO, value: produto.id },
  });

  return produto;
}

// ------------------------------------------------------------ Taxa do cartão

function feeDaLinha(
  tabela: TaxaDeCartao[],
  metodo: string,
  parcelas: number,
  informada: number | null | undefined,
  bandeira?: string | null,
): Prisma.Decimal | null {
  if (metodo !== 'CREDITO') return null;
  const taxa = informada ?? taxaDe(tabela, parcelas, bandeira === 'elo' ? 'elo' : 'padrao');
  return taxa != null ? new Prisma.Decimal(taxa) : null;
}

function liquidoDaLinha(
  tabela: TaxaDeCartao[],
  metodo: string,
  valor: number,
  parcelas: number,
  informada: number | null | undefined,
  bandeira?: string | null,
): Prisma.Decimal {
  if (metodo === 'EM_ABERTO') return new Prisma.Decimal(0);
  const taxa = feeDaLinha(tabela, metodo, parcelas, informada, bandeira);
  return new Prisma.Decimal(taxa ? valor * (1 - Number(taxa) / 100) : valor);
}

// ------------------------------------------------------------------ Schemas

const checklistSchema = z
  .record(z.string(), z.union([z.boolean(), z.string(), z.number(), z.null()]))
  .optional()
  .nullable();

const dadosAparelhoSchema = {
  deviceBrand: z.string().trim().max(60).optional().nullable(),
  deviceModel: z.string().trim().min(1, 'Informe o aparelho').max(120),
  deviceColor: z.string().trim().max(40).optional().nullable(),
  deviceImei: z.string().trim().max(40).optional().nullable(),
  deviceSerial: z.string().trim().max(60).optional().nullable(),
  devicePassword: z.string().trim().max(120).optional().nullable(),
  accessories: z.string().trim().max(400).optional().nullable(),
  conditionIn: z.string().trim().max(600).optional().nullable(),
  checklistIn: checklistSchema,
  batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
};

const criarSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().min(2, 'Informe o nome do cliente').max(180),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),
  ...dadosAparelhoSchema,
  reportedProblem: z.string().trim().min(3, 'Descreva o problema relatado').max(2000),
  estimatedValue: z.coerce.number().min(0).max(9_999_999).optional().nullable(),
  technicianId: z.string().uuid().optional().nullable(),
  internalNotes: z.string().trim().max(2000).optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  photos: z.array(fotoSchema).max(8).optional(),
});

const editarSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().min(2).max(180).optional(),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  customerDocument: z.string().trim().max(30).optional().nullable(),
  deviceBrand: z.string().trim().max(60).optional().nullable(),
  deviceModel: z.string().trim().min(1).max(120).optional(),
  deviceColor: z.string().trim().max(40).optional().nullable(),
  deviceImei: z.string().trim().max(40).optional().nullable(),
  deviceSerial: z.string().trim().max(60).optional().nullable(),
  devicePassword: z.string().trim().max(120).optional().nullable(),
  accessories: z.string().trim().max(400).optional().nullable(),
  conditionIn: z.string().trim().max(600).optional().nullable(),
  checklistIn: checklistSchema,
  batteryHealth: z.coerce.number().int().min(0).max(100).optional().nullable(),
  reportedProblem: z.string().trim().min(3).max(2000).optional(),
  diagnosis: z.string().trim().max(2000).optional().nullable(),
  internalNotes: z.string().trim().max(2000).optional().nullable(),
  estimatedValue: z.coerce.number().min(0).max(9_999_999).optional().nullable(),
  technicianId: z.string().uuid().optional().nullable(),
  photos: z.array(fotoSchema).max(8).optional(),
});

const itemOrcamentoSchema = z.object({
  kind: z.enum(['PECA', 'SERVICO']),
  description: z.string().trim().min(1, 'Descreva o item').max(200),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  unitPrice: z.coerce.number().min(0).max(9_999_999),
  costPrice: z.coerce.number().min(0).max(9_999_999).optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  deviceUnitId: z.string().uuid().optional().nullable(),
});

const orcamentoSchema = z.object({
  diagnosis: z.string().trim().max(2000).optional().nullable(),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  discount: z.coerce.number().min(0).max(9_999_999).optional().nullable(),
  items: z.array(itemOrcamentoSchema).max(40),
});

const pagamentoSchema = z.object({
  method: z.enum(PAGAMENTOS),
  amount: z.coerce.number().min(0.01, 'Informe o valor desta forma'),
  installments: z.coerce.number().int().min(1).max(24).default(1),
  feePercent: z.coerce.number().min(0).max(99.99).optional().nullable(),
  bandeira: z.enum(['padrao', 'elo']).optional().nullable(),
  autorizacao: z.string().trim().max(30).optional().nullable(),
  destino: z.string().trim().max(60).optional().nullable(),
});

const entregaSchema = z.object({
  payments: z.array(pagamentoSchema).min(1, 'Informe como o cliente pagou').max(6),
  discount: z.coerce.number().min(0).max(9_999_999).optional().nullable(),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  photos: z.array(fotoSchema).max(6).optional(),
});

// ------------------------------------------------------------------ Helpers

async function carregar(id: string): Promise<OrdemCompleta> {
  const os = await db.serviceOrder.findUnique({ where: { id }, include: COM_TUDO });
  if (!os) throw naoEncontrado('Ordem de serviço');
  return os;
}

interface ItemCalculavel {
  unitPrice: Prisma.Decimal | number;
  quantity: number;
  costPrice: Prisma.Decimal | number;
}

/** Soma dos itens de uma OS, já com desconto. */
function totaisDosItens(itens: ItemCalculavel[], desconto: number) {
  const bruto = itens.reduce((s, i) => s + numero(i.unitPrice) * i.quantity, 0);
  const custo = itens.reduce((s, i) => s + numero(i.costPrice) * i.quantity, 0);
  return { bruto, custo, total: Math.max(0, bruto - desconto) };
}

// ---------------------------------------------------------------- Listagem

rotasOrdens.get(
  '/',
  exigir('os.ver'),
  rota(async (req, res) => {
    const q = validar(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        status: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
          .pipe(z.array(z.enum(STATUS)).min(1).optional()),
        abertas: z.enum(['true', 'false']).optional(),
        search: z.string().trim().max(120).optional(),
        unitId: z.string().uuid().optional(),
        technicianId: z.string().uuid().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
      semVazios(req.query),
    );

    const unidade = unidadePermitida(req.usuario, q.unitId);
    const p = paginacao(q as Record<string, unknown>);

    const cond: Prisma.ServiceOrderWhereInput[] = [];
    if (unidade) cond.push({ unitId: unidade });
    if (q.status) cond.push({ status: { in: q.status } });
    if (q.abertas === 'true') cond.push({ status: { in: ABERTOS } });
    if (q.technicianId) cond.push({ technicianId: q.technicianId });
    if (q.search) {
      cond.push({
        OR: [
          { code: contem(q.search) },
          { customerName: contem(q.search) },
          { customerPhone: contem(q.search) },
          { deviceImei: contem(q.search) },
          { deviceSerial: contem(q.search) },
          { deviceModel: contem(q.search) },
        ],
      });
    }
    const periodo = intervalo(q.startDate, q.endDate);
    if (periodo) cond.push({ createdAt: periodo });

    const where: Prisma.ServiceOrderWhereInput = cond.length ? { AND: cond } : {};

    const [lista, total, porStatus] = await Promise.all([
      db.serviceOrder.findMany({
        where,
        include: COM_TUDO,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      }),
      db.serviceOrder.count({ where }),
      db.serviceOrder.groupBy({
        by: ['status'],
        where: unidade ? { unitId: unidade } : {},
        _count: true,
      }),
    ]);

    const contadores = Object.fromEntries(STATUS.map((s) => [s, 0])) as Record<Status, number>;
    for (const g of porStatus) contadores[g.status as Status] = g._count;
    const abertasTotal = ABERTOS.reduce((s, k) => s + contadores[k], 0);

    res.json(
      limpar({
        ...paginado(lista.map(paraJson), total, p),
        contadores: { ...contadores, ABERTAS: abertasTotal },
      }),
    );
  }),
);

rotasOrdens.get(
  '/:id',
  exigir('os.ver'),
  rota(async (req, res) => {
    res.json(paraJson(await carregar(req.params.id)));
  }),
);

rotasOrdens.get(
  '/fotos/:id',
  exigir('os.ver'),
  rota(async (req, res) => {
    const foto = await db.serviceOrderPhoto.findUnique({ where: { id: req.params.id } });
    if (!foto) throw naoEncontrado('Foto');
    res.setHeader('Content-Type', foto.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(Buffer.from(foto.data));
  }),
);

// ------------------------------------------------------------------ Entrada

rotasOrdens.post(
  '/',
  exigir('os.criar'),
  rota(async (req, res) => {
    const dados = validar(criarSchema, req.body);

    const unidadeId =
      dados.unitId ?? req.usuario!.unidadeId ?? (await unidadeDeVenda())?.id ?? null;
    if (!unidadeId) throw new AppError('Nenhuma unidade cadastrada para receber a OS.', 500);

    if (dados.technicianId) {
      const tecnico = await db.user.findUnique({ where: { id: dados.technicianId } });
      if (!tecnico) throw naoEncontrado('Técnico');
    }

    const os = await db.serviceOrder.create({
      data: {
        code: await proximoCodigo('ordem', 'OS'),
        customerId: dados.customerId ?? null,
        customerName: dados.customerName,
        customerPhone: dados.customerPhone ?? null,
        customerDocument: dados.customerDocument ?? null,
        deviceBrand: dados.deviceBrand ?? null,
        deviceModel: dados.deviceModel,
        deviceColor: dados.deviceColor ?? null,
        deviceImei: dados.deviceImei ?? null,
        deviceSerial: dados.deviceSerial ?? null,
        devicePassword: dados.devicePassword ?? null,
        accessories: dados.accessories ?? null,
        conditionIn: dados.conditionIn ?? null,
        checklistIn: checklistParaBanco(dados.checklistIn),
        batteryHealth: dados.batteryHealth ?? null,
        reportedProblem: dados.reportedProblem,
        estimatedValue:
          dados.estimatedValue != null ? new Prisma.Decimal(dados.estimatedValue) : null,
        internalNotes: dados.internalNotes ?? null,
        technicianId: dados.technicianId ?? null,
        unitId: unidadeId,
        photos: { create: separarFotos(dados.photos, 'ENTRADA') },
      },
      include: COM_TUDO,
    });

    await registrarLog({
      acao: 'CRIAR_OS',
      entidade: 'ServiceOrder',
      id: os.id,
      alteracoes: { codigo: os.code, aparelho: os.deviceModel, cliente: os.customerName },
      req,
    });

    if (os.technicianId && os.technicianId !== req.usuario!.id) {
      await notificar({
        userId: os.technicianId,
        title: `Nova OS ${os.code}`,
        message: `${os.deviceModel} · ${os.customerName} · ${os.reportedProblem.slice(0, 80)}`,
        link: '/assistencia',
      });
    } else {
      await notificarPerfil('GERENTE', {
        title: `Nova OS ${os.code}`,
        message: `${os.deviceModel} · ${os.customerName}`,
        link: '/assistencia',
      });
    }

    res.status(201).json({
      ...paraJson(os),
      message: `OS ${os.code} aberta — ${os.deviceModel} de ${os.customerName}.`,
    });
  }),
);

// ------------------------------------------------------------------- Edição

rotasOrdens.put(
  '/:id',
  exigir('os.editar'),
  rota(async (req, res) => {
    const dados = validar(editarSchema, req.body);
    const os = await carregar(req.params.id);

    if (os.status === 'ENTREGUE' || os.status === 'CANCELADO') {
      throw new AppError('Esta OS está finalizada e não pode mais ser alterada.');
    }

    if (dados.technicianId) {
      const tecnico = await db.user.findUnique({ where: { id: dados.technicianId } });
      if (!tecnico) throw naoEncontrado('Técnico');
    }

    const texto = <T,>(v: T | undefined | null) => (v === undefined ? undefined : v || null);

    const atualizada = await db.serviceOrder.update({
      where: { id: os.id },
      data: {
        ...(dados.customerId !== undefined ? { customerId: dados.customerId ?? null } : {}),
        ...(dados.customerName !== undefined ? { customerName: dados.customerName } : {}),
        ...(dados.customerPhone !== undefined ? { customerPhone: texto(dados.customerPhone) } : {}),
        ...(dados.customerDocument !== undefined
          ? { customerDocument: texto(dados.customerDocument) }
          : {}),
        ...(dados.deviceBrand !== undefined ? { deviceBrand: texto(dados.deviceBrand) } : {}),
        ...(dados.deviceModel !== undefined ? { deviceModel: dados.deviceModel } : {}),
        ...(dados.deviceColor !== undefined ? { deviceColor: texto(dados.deviceColor) } : {}),
        ...(dados.deviceImei !== undefined ? { deviceImei: texto(dados.deviceImei) } : {}),
        ...(dados.deviceSerial !== undefined ? { deviceSerial: texto(dados.deviceSerial) } : {}),
        ...(dados.devicePassword !== undefined
          ? { devicePassword: texto(dados.devicePassword) }
          : {}),
        ...(dados.accessories !== undefined ? { accessories: texto(dados.accessories) } : {}),
        ...(dados.conditionIn !== undefined ? { conditionIn: texto(dados.conditionIn) } : {}),
        ...(dados.checklistIn !== undefined
          ? { checklistIn: checklistParaBanco(dados.checklistIn) }
          : {}),
        ...(dados.batteryHealth !== undefined ? { batteryHealth: dados.batteryHealth ?? null } : {}),
        ...(dados.reportedProblem !== undefined ? { reportedProblem: dados.reportedProblem } : {}),
        ...(dados.diagnosis !== undefined ? { diagnosis: texto(dados.diagnosis) } : {}),
        ...(dados.internalNotes !== undefined ? { internalNotes: texto(dados.internalNotes) } : {}),
        ...(dados.estimatedValue !== undefined
          ? {
              estimatedValue:
                dados.estimatedValue != null ? new Prisma.Decimal(dados.estimatedValue) : null,
            }
          : {}),
        ...(dados.technicianId !== undefined ? { technicianId: dados.technicianId ?? null } : {}),
        ...(dados.photos?.length
          ? { photos: { create: separarFotos(dados.photos, 'ENTRADA') } }
          : {}),
      },
      include: COM_TUDO,
    });

    await registrarLog({ acao: 'EDITAR_OS', entidade: 'ServiceOrder', id: os.id, req });
    res.json({ ...paraJson(atualizada), message: `OS ${os.code} atualizada.` });
  }),
);

// ------------------------------------------------------- Transição de status

rotasOrdens.post(
  '/:id/status',
  exigir('os.editar'),
  rota(async (req, res) => {
    const { status } = validar(z.object({ status: z.enum(STATUS) }), req.body);
    const os = await carregar(req.params.id);

    if (os.status === status) {
      res.json({ ...paraJson(os), message: `OS ${os.code} já está em "${STATUS_LABEL[status]}".` });
      return;
    }

    const permitidas = TRANSICOES[os.status] ?? [];
    if (!permitidas.includes(status)) {
      throw new AppError(
        `Não dá para mudar de "${STATUS_LABEL[os.status as Status]}" para "${STATUS_LABEL[status]}".`,
      );
    }

    const atualizada = await db.serviceOrder.update({
      where: { id: os.id },
      data: {
        status,
        ...(status === 'PRONTO' && !os.readyAt ? { readyAt: new Date() } : {}),
      },
      include: COM_TUDO,
    });

    await registrarLog({
      acao: 'STATUS_OS',
      entidade: 'ServiceOrder',
      id: os.id,
      alteracoes: { de: os.status, para: status },
      req,
    });

    if (status === 'PRONTO') {
      await notificarPerfil('CAIXA', {
        title: `OS ${os.code} pronta`,
        message: `${os.deviceModel} · ${os.customerName} — pronta para retirada`,
        link: '/assistencia',
      });
    }

    res.json({ ...paraJson(atualizada), message: `OS ${os.code}: ${STATUS_LABEL[status]}.` });
  }),
);

// ---------------------------------------------------------------- Orçamento

rotasOrdens.post(
  '/:id/orcamento',
  exigir('os.orcar'),
  rota(async (req, res) => {
    const dados = validar(orcamentoSchema, req.body);
    const os = await carregar(req.params.id);

    if (['ENTREGUE', 'CANCELADO'].includes(os.status)) {
      throw new AppError('Esta OS está finalizada.');
    }

    // Congela o custo de cada peça a partir do estoque (o preço de venda é
    // o que o técnico digitou).
    const itens: {
      kind: 'PECA' | 'SERVICO';
      description: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      costPrice: Prisma.Decimal;
      productId: string | null;
      deviceUnitId: string | null;
    }[] = [];
    for (const it of dados.items) {
      let custo = it.costPrice ?? 0;
      let productId: string | null = null;
      let deviceUnitId: string | null = null;

      if (it.kind === 'PECA' && it.deviceUnitId) {
        const dev = await db.deviceUnit.findUnique({
          where: { id: it.deviceUnitId },
          select: { id: true, productId: true, costPrice: true, status: true },
        });
        if (!dev) throw naoEncontrado('Aparelho');
        if (dev.status === 'VENDIDO') {
          throw new AppError('Esse aparelho já saiu do estoque. Escolha outro.');
        }
        deviceUnitId = dev.id;
        productId = it.productId ?? dev.productId;
        custo = numero(dev.costPrice);
      } else if (it.kind === 'PECA' && it.productId) {
        const prod = await db.product.findUnique({
          where: { id: it.productId },
          select: { id: true, costPrice: true },
        });
        if (!prod) throw naoEncontrado('Produto');
        productId = prod.id;
        custo = numero(prod.costPrice);
      }

      itens.push({
        kind: it.kind,
        description: it.description,
        quantity: it.quantity,
        unitPrice: new Prisma.Decimal(it.unitPrice),
        costPrice: new Prisma.Decimal(custo),
        productId,
        deviceUnitId,
      });
    }

    const desconto = dados.discount ?? numero(os.discount);
    const { total } = totaisDosItens(itens, desconto);

    const atualizada = await db.$transaction(async (tx) => {
      await tx.serviceOrderItem.deleteMany({ where: { serviceOrderId: os.id } });
      if (itens.length) {
        await tx.serviceOrderItem.createMany({
          data: itens.map((i) => ({ ...i, serviceOrderId: os.id })),
        });
      }
      return tx.serviceOrder.update({
        where: { id: os.id },
        data: {
          status: 'ORCAMENTO',
          quotedValue: new Prisma.Decimal(total),
          discount: new Prisma.Decimal(desconto),
          ...(dados.warrantyDays !== undefined ? { warrantyDays: dados.warrantyDays ?? null } : {}),
          ...(dados.diagnosis !== undefined ? { diagnosis: dados.diagnosis || null } : {}),
        },
        include: COM_TUDO,
      });
    });

    await registrarLog({
      acao: 'ORCAR_OS',
      entidade: 'ServiceOrder',
      id: os.id,
      alteracoes: { itens: itens.length, total },
      req,
    });

    res.json({
      ...paraJson(atualizada),
      message: `Orçamento da OS ${os.code}: R$ ${total.toFixed(2)} · aguardando o cliente.`,
    });
  }),
);

// -------------------------------------------------------- Aprovar / recusar

rotasOrdens.post(
  '/:id/aprovar',
  exigir('os.orcar'),
  rota(async (req, res) => {
    const os = await carregar(req.params.id);
    if (os.status === 'APROVADO') {
      res.json({ ...paraJson(os), message: `OS ${os.code} já estava aprovada.` });
      return;
    }
    if (os.status !== 'ORCAMENTO') {
      throw new AppError('Só dá para aprovar uma OS que está com orçamento enviado.');
    }
    if (!os.items.length) throw new AppError('Monte o orçamento antes de aprovar.');

    const atualizada = await db.serviceOrder.update({
      where: { id: os.id },
      data: { status: 'APROVADO', approvedAt: new Date() },
      include: COM_TUDO,
    });

    await registrarLog({ acao: 'APROVAR_OS', entidade: 'ServiceOrder', id: os.id, req });
    if (os.technicianId) {
      await notificar({
        userId: os.technicianId,
        title: `OS ${os.code} aprovada`,
        message: `${os.deviceModel} · ${os.customerName} — pode consertar`,
        link: '/assistencia',
      });
    }
    res.json({ ...paraJson(atualizada), message: `OS ${os.code} aprovada pelo cliente.` });
  }),
);

rotasOrdens.post(
  '/:id/recusar',
  exigir('os.orcar'),
  rota(async (req, res) => {
    const { motivo } = validar(
      z.object({ motivo: z.string().trim().max(500).optional().nullable() }),
      req.body ?? {},
    );
    const os = await carregar(req.params.id);
    if (!['ORCAMENTO', 'APROVADO', 'EM_ANALISE'].includes(os.status)) {
      throw new AppError('Esta OS não está numa etapa que possa ser recusada.');
    }

    const nota = motivo?.trim()
      ? `${os.internalNotes ? `${os.internalNotes}\n` : ''}Recusado pelo cliente: ${motivo.trim()}`
      : os.internalNotes;

    const atualizada = await db.serviceOrder.update({
      where: { id: os.id },
      data: { status: 'RECUSADO', internalNotes: nota },
      include: COM_TUDO,
    });

    await registrarLog({
      acao: 'RECUSAR_OS',
      entidade: 'ServiceOrder',
      id: os.id,
      alteracoes: { motivo: motivo?.trim() || null },
      req,
    });
    res.json({
      ...paraJson(atualizada),
      message: `OS ${os.code} recusada — o aparelho volta para o cliente.`,
    });
  }),
);

// ------------------------------------------------------------------ Entrega

rotasOrdens.post(
  '/:id/entregar',
  exigir('os.entregar'),
  rota(async (req, res) => {
    const dados = validar(entregaSchema, req.body);
    const base = await carregar(req.params.id);

    if (base.status === 'ENTREGUE' || base.saleId) {
      throw new AppError('Esta OS já foi entregue.');
    }
    if (!PODE_ENTREGAR.includes(base.status as Status)) {
      throw new AppError('Aprove o orçamento antes de entregar a OS.');
    }
    if (!base.items.length) {
      throw new AppError('A OS não tem peças nem serviço no orçamento.');
    }

    const emAberto = dados.payments.some((p) => p.method === 'EM_ABERTO');
    if (emAberto && !base.customerPhone?.trim()) {
      throw new AppError('Para deixar valor em aberto, cadastre o telefone do cliente na OS.');
    }

    const desconto = dados.discount ?? numero(base.discount);
    const { total, bruto } = totaisDosItens(base.items, desconto);

    const somaPagamentos = dados.payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(somaPagamentos - total) > 0.005) {
      throw new AppError(
        `As formas de pagamento somam R$ ${somaPagamentos.toFixed(2)}, mas o total da OS é R$ ${total.toFixed(2)}.`,
      );
    }

    const [tabela, turno, tecnico] = await Promise.all([
      taxasDoCartao(),
      db.cashRegister.findFirst({
        where: { cashierId: req.usuario!.id, status: 'ABERTO' },
        orderBy: { openedAt: 'desc' },
      }),
      base.technicianId
        ? db.user.findUnique({ where: { id: base.technicianId }, select: { name: true } })
        : null,
    ]);

    const warrantyDays = dados.warrantyDays ?? base.warrantyDays ?? null;

    const resultado = await db.$transaction(async (tx) => {
      // Relê dentro da transação: se outra retirada correu em paralelo, para aqui.
      const trava = await tx.serviceOrder.findUnique({
        where: { id: base.id },
        select: { status: true, saleId: true },
      });
      if (trava?.saleId || trava?.status === 'ENTREGUE') {
        throw new AppError('Esta OS já foi entregue.', 409);
      }

      const servico = await produtoDeServico(tx);

      // Resolve cada item: peça UNITARIO confere o aparelho, peça QUANTIDADE
      // confere o saldo, serviço não mexe no estoque.
      type LinhaVenda = {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        costPrice: Prisma.Decimal;
        imei: string | null;
        serialNumber: string | null;
        deviceId: string | null;
        motivoEstoque: 'REPARO' | null;
        itemId: string;
      };

      const linhas: LinhaVenda[] = [];

      for (const item of base.items) {
        if (item.kind === 'SERVICO') {
          linhas.push({
            productId: servico.id,
            productName: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
            imei: null,
            serialNumber: null,
            deviceId: null,
            motivoEstoque: null,
            itemId: item.id,
          });
          continue;
        }

        if (!item.productId) {
          // Peça digitada à mão, sem produto no estoque: entra como serviço
          // (não há o que baixar).
          linhas.push({
            productId: servico.id,
            productName: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
            imei: null,
            serialNumber: null,
            deviceId: null,
            motivoEstoque: null,
            itemId: item.id,
          });
          continue;
        }

        const produto = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, costPrice: true, tipoControle: true, semEstoque: true },
        });
        if (!produto) throw naoEncontrado('Produto');

        if (produto.tipoControle === 'UNITARIO') {
          const dev = await tx.deviceUnit.findFirst({
            where: {
              ...(item.deviceUnitId ? { id: item.deviceUnitId } : {}),
              productId: produto.id,
              status: 'EM_ESTOQUE',
              unitId: base.unitId,
            },
          });
          if (!dev) {
            throw new AppError(
              `Sem aparelho de "${produto.name}" disponível na unidade da OS para o conserto.`,
              409,
            );
          }
          linhas.push({
            productId: produto.id,
            productName: produto.name,
            quantity: 1,
            unitPrice: item.unitPrice,
            costPrice: dev.costPrice,
            imei: dev.imei,
            serialNumber: dev.serialNumber,
            deviceId: dev.id,
            motivoEstoque: 'REPARO',
            itemId: item.id,
          });
        } else {
          if (!produto.semEstoque) {
            const livre = await disponivel(produto.id, base.unitId, tx);
            if (livre < item.quantity) {
              throw new AppError(
                `Estoque insuficiente de "${produto.name}" para o conserto. Disponível: ${livre}.`,
              );
            }
          }
          linhas.push({
            productId: produto.id,
            productName: produto.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: produto.costPrice,
            imei: null,
            serialNumber: null,
            deviceId: null,
            motivoEstoque: produto.semEstoque ? null : 'REPARO',
            itemId: item.id,
          });
        }
      }

      const custoTotal = linhas.reduce(
        (s, l) => s.add(l.costPrice.mul(l.quantity)),
        new Prisma.Decimal(0),
      );

      const pagamentos = dados.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: new Prisma.Decimal(p.amount.toFixed(2)),
        installments: p.installments,
        destino: p.destino?.trim() || null,
        bandeira: p.method === 'CREDITO' ? (p.bandeira === 'elo' ? 'elo' : 'padrao') : null,
        autorizacao: p.autorizacao?.trim() || null,
        feePercent: feeDaLinha(tabela, p.method, p.installments, p.feePercent, p.bandeira),
        netAmount: liquidoDaLinha(tabela, p.method, p.amount, p.installments, p.feePercent, p.bandeira),
      }));

      const principal =
        pagamentos.reduce<(typeof pagamentos)[number] | null>(
          (maior, p) => (!maior || p.amount.greaterThan(maior.amount) ? p : maior),
          null,
        )?.method ?? ('DINHEIRO' as PaymentMethod);

      const venda = await tx.sale.create({
        data: {
          code: await proximoCodigo('venda', 'VD', tx),
          totalAmount: new Prisma.Decimal(total),
          costAmount: custoTotal,
          paymentMethod: principal,
          installments: pagamentos[0]?.installments ?? 1,
          payments: { create: pagamentos },
          saleDate: new Date(),
          notes: `Ordem de Serviço ${base.code}` + (dados.notes?.trim() ? ` · ${dados.notes.trim()}` : ''),
          unitId: base.unitId,
          customerId: base.customerId,
          customerName: base.customerName,
          customerPhone: base.customerPhone,
          customerDocument: base.customerDocument,
          sellerId: base.technicianId ?? req.usuario!.id,
          sellerName: tecnico?.name ?? req.usuario!.nome,
          cashierId: req.usuario!.id,
          cashRegisterId: turno?.id ?? null,
        },
      });

      for (const linha of linhas) {
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: venda.id,
            productId: linha.productId,
            productName: linha.productName,
            quantity: linha.quantity,
            unitPrice: linha.unitPrice,
            costPrice: linha.costPrice,
            imei: linha.imei,
            serialNumber: linha.serialNumber,
          },
        });

        if (linha.motivoEstoque) {
          await movimentar({
            produtoId: linha.productId,
            produtoNome: linha.productName,
            unidadeId: base.unitId,
            tipo: 'SAIDA',
            motivo: 'REPARO',
            quantidade: linha.quantity,
            observacao:
              `Peça usada no conserto — OS ${base.code}` +
              (linha.imei ? ` · IMEI ${linha.imei}` : '') +
              (linha.serialNumber ? ` · série ${linha.serialNumber}` : ''),
            vendaId: venda.id,
            usuarioId: req.usuario!.id,
            usuarioNome: req.usuario!.nome,
            deviceIds: linha.deviceId ? [linha.deviceId] : undefined,
            statusDoDevice: linha.deviceId ? 'VENDIDO' : undefined,
            tx,
          });

          if (linha.deviceId) {
            await tx.deviceUnit.update({
              where: { id: linha.deviceId },
              data: { saleItemId: saleItem.id },
            });
          }
        }

        // Amarra o item da OS ao aparelho de fato consumido.
        if (linha.deviceId) {
          await tx.serviceOrderItem.update({
            where: { id: linha.itemId },
            data: { deviceUnitId: linha.deviceId, costPrice: linha.costPrice },
          });
        }
      }

      const now = new Date();
      const os = await tx.serviceOrder.update({
        where: { id: base.id },
        data: {
          status: 'ENTREGUE',
          deliveredAt: now,
          readyAt: base.readyAt ?? now,
          saleId: venda.id,
          discount: new Prisma.Decimal(desconto),
          quotedValue: base.quotedValue ?? new Prisma.Decimal(bruto),
          totalAmount: new Prisma.Decimal(total),
          costAmount: custoTotal,
          warrantyDays,
          warrantyUntil: warrantyDays && warrantyDays > 0 ? somarDias(now, warrantyDays) : null,
          photos: dados.photos?.length
            ? { create: separarFotos(dados.photos, 'SAIDA') }
            : undefined,
        },
        include: COM_TUDO,
      });

      return { os, venda };
    });

    await registrarLog({
      acao: 'ENTREGAR_OS',
      entidade: 'ServiceOrder',
      id: base.id,
      alteracoes: { codigo: base.code, venda: resultado.venda.code, total },
      req,
    });

    if (base.technicianId && base.technicianId !== req.usuario!.id) {
      await notificar({
        userId: base.technicianId,
        title: `OS ${base.code} entregue`,
        message: `${base.deviceModel} · ${base.customerName} · R$ ${total.toFixed(2)}`,
        link: '/assistencia',
      });
    }

    res.json({
      ...paraJson(resultado.os),
      sale: limpar({
        id: resultado.venda.id,
        code: resultado.venda.code,
        totalAmount: resultado.venda.totalAmount,
      }),
      message: `OS ${base.code} entregue · venda ${resultado.venda.code} · R$ ${total.toFixed(2)}.`,
    });
  }),
);

// ---------------------------------------------------------------- Cancelar

rotasOrdens.delete(
  '/:id',
  exigir('os.editar'),
  rota(async (req, res) => {
    const motivo = String(req.query.reason ?? '').trim();
    const os = await carregar(req.params.id);

    if (os.status === 'ENTREGUE') {
      throw new AppError('Uma OS entregue faz parte do histórico e não pode ser cancelada.');
    }
    if (os.status === 'CANCELADO') {
      res.json({ ...paraJson(os), message: `OS ${os.code} já estava cancelada.` });
      return;
    }

    const atualizada = await db.serviceOrder.update({
      where: { id: os.id },
      data: {
        status: 'CANCELADO',
        internalNotes: motivo
          ? `${os.internalNotes ? `${os.internalNotes}\n` : ''}Cancelada: ${motivo}`
          : os.internalNotes,
      },
      include: COM_TUDO,
    });

    await registrarLog({
      acao: 'CANCELAR_OS',
      entidade: 'ServiceOrder',
      id: os.id,
      alteracoes: { codigo: os.code, motivo: motivo || null },
      req,
    });
    res.json({ ...paraJson(atualizada), message: `OS ${os.code} cancelada.` });
  }),
);

// -------------------------------------------------------------- Comprovante

rotasOrdens.get(
  '/:id/comprovante',
  exigir('os.ver'),
  rota(async (req, res) => {
    const os = await db.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: [{ kind: 'asc' }, { description: 'asc' }] },
        technician: { select: { name: true } },
        unit: { select: { name: true } },
        sale: { include: { payments: { orderBy: { amount: 'desc' } } } },
      },
    });
    if (!os) throw new AppError('Ordem de serviço não encontrada', 404);

    const entregue = os.status === 'ENTREGUE';

    comprovanteDeOS(res, {
      modo: entregue ? 'servico' : 'entrada',
      loja: await lojaSalva(),
      code: os.code,
      statusLabel: STATUS_LABEL[os.status as Status] ?? os.status,
      createdAt: os.createdAt,
      deliveredAt: os.deliveredAt,
      customerName: os.customerName,
      customerPhone: os.customerPhone,
      customerDocument: os.customerDocument,
      technicianName: os.technician?.name ?? null,
      unitName: os.unit?.name ?? null,
      device: {
        brand: os.deviceBrand,
        model: os.deviceModel,
        color: os.deviceColor,
        imei: os.deviceImei,
        serial: os.deviceSerial,
        batteryHealth: os.batteryHealth,
      },
      accessories: os.accessories,
      conditionIn: os.conditionIn,
      checklist:
        os.checklistIn && typeof os.checklistIn === 'object' && !Array.isArray(os.checklistIn)
          ? (os.checklistIn as Record<string, unknown>)
          : null,
      reportedProblem: os.reportedProblem,
      diagnosis: os.diagnosis,
      estimatedValue: os.estimatedValue ? numero(os.estimatedValue) : null,
      items: os.items.map((i) => ({
        kind: i.kind,
        description: i.description,
        quantity: i.quantity,
        unitPrice: numero(i.unitPrice),
      })),
      payments: (os.sale?.payments ?? []).map((p) => ({
        method: p.method,
        amount: numero(p.amount),
        installments: p.installments,
      })),
      discount: numero(os.discount),
      total: entregue ? numero(os.totalAmount) : numero(os.quotedValue),
      warrantyDays: os.warrantyDays,
      warrantyUntil: os.warrantyUntil,
      observacao: null,
    });
  }),
);
