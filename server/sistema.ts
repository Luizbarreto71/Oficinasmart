import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import { autenticar, somenteAdmin } from './auth.js';
import { AppError, limpar, rota, validar } from './core.js';
import { z } from 'zod';
import { exigir } from './permissoes.js';
import { db, registrarLog } from './db.js';
import { normalizarTaxas, TAXAS_PADRAO, type TaxaDeCartao } from '../shared/taxas.js';
import { LOJA_PADRAO, normalizarLoja, type DadosDaLoja } from '../shared/loja.js';
import { MOTIVO_LABEL, movimentar, sincronizarSaldoUnitario, TIPO_LABEL } from './estoque.js';
import { planilhaConfigurada, reescreverPlanilha, statusPlanilha } from './planilha.js';

/** Importação de planilha, backup e integração com o Google Sheets. */

export const rotasSistema = Router();

/**
 * Preferências que a loja inteira lê, mas só o administrador muda.
 */
const LEITURA_LIBERADA = new Set([
  '/taxas-cartao',
  '/loja',
  '/unidade-de-venda',
  '/contas-pix',
  '/chave-de-acesso',
  '/emojis-categoria',
  '/meta-de-vendas',
]);

rotasSistema.use(autenticar, (req, res, next) => {
  if (req.method === 'GET' && LEITURA_LIBERADA.has(req.path)) return next();
  return exigir('configuracoes')(req, res, next);
});

// ---------------------------------------------------------------- Planilha

rotasSistema.get(
  '/sheets/status',
  rota(async (_req, res) => {
    res.json(statusPlanilha());
  }),
);

rotasSistema.post(
  '/sheets/sync',
  somenteAdmin,
  rota(async (req, res) => {
    if (!planilhaConfigurada()) {
      throw new AppError('Integração com Google Sheets não configurada. Preencha as variáveis GOOGLE_* no .env.');
    }

    const [movimentos, unidades] = await Promise.all([
      db.stockMovement.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { name: true } },
          unit: { select: { name: true } },
          product: { include: { category: true } },
        },
      }),
      db.unit.findMany({ select: { id: true, name: true } }),
    ]);

    const nome = (id?: string | null) => unidades.find((u) => u.id === id)?.name ?? '';

    const total = await reescreverPlanilha(
      movimentos.map((m) => ({
        data: m.createdAt,
        produto: m.productName ?? m.product?.name ?? '—',
        categoria: m.product?.category.name ?? '—',
        unidade: m.unit?.name ?? '—',
        tipo: TIPO_LABEL[m.type],
        quantidade: m.type === 'ENTRADA' ? m.quantity : -m.quantity,
        estoqueAnterior: m.previousQuantity ?? 0,
        estoquePosterior: m.newQuantity ?? 0,
        origem: nome(m.originUnitId),
        destino: nome(m.destinationUnitId),
        usuario: m.user?.name ?? '',
        motivo: MOTIVO_LABEL[m.reason],
        observacao: m.notes ?? '',
        movimentoId: m.id,
      })),
    );

    await registrarLog({ acao: 'SHEETS_SYNC', entidade: 'Setting', req });
    res.json({ message: `${total} movimentação(ões) sincronizadas com a planilha.`, synced: total });
  }),
);

// ------------------------------------------------------------------ Backup

rotasSistema.get(
  '/backup',
  somenteAdmin,
  rota(async (req, res) => {
    const [categorias, fornecedores, clientes, produtos, aparelhos, vendas, movimentos, usuarios] =
      await Promise.all([
        db.category.findMany(),
        db.supplier.findMany(),
        db.customer.findMany(),
        db.product.findMany(),
        db.deviceUnit.findMany(),
        db.sale.findMany(),
        db.stockMovement.findMany(),
        db.user.findMany({
          select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
        }),
      ]);

    const backup = limpar({
      generatedAt: new Date().toISOString(),
      system: 'Oficina do Smartphone',
      counts: {
        categories: categorias.length,
        suppliers: fornecedores.length,
        customers: clientes.length,
        products: produtos.length,
        devices: aparelhos.length,
        sales: vendas.length,
        movements: movimentos.length,
        users: usuarios.length,
      },
      data: {
        categories: categorias,
        suppliers: fornecedores,
        customers: clientes,
        products: produtos,
        devices: aparelhos,
        sales: vendas,
        movements: movimentos,
        users: usuarios,
      },
    });

    await registrarLog({ acao: 'BACKUP', entidade: 'Setting', req });

    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="backup-oficina-${carimbo}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  }),
);

// -------------------------------------------------------------- Importação

const CABECALHOS = [
  'Categoria',
  'Nome',
  'Marca',
  'Modelo',
  'Cor',
  'Capacidade',
  'Quantidade',
  'Preço de Custo',
  'Preço de Venda',
  'Preço de Atacado',
  'Fornecedor',
  'IMEI',
  'Número de Série',
  'Saúde da Bateria',
  'Lote',
  'Condição',
  'Observações',
];

const DE_PARA: Record<string, string> = {
  categoria: 'category',
  nome: 'name',
  produto: 'name',
  marca: 'brand',
  modelo: 'model',
  cor: 'color',
  capacidade: 'capacity',
  ram: 'ram',
  quantidade: 'quantity',
  qtd: 'quantity',
  'preco de custo': 'costPrice',
  'preço de custo': 'costPrice',
  custo: 'costPrice',
  'preco de venda': 'salePrice',
  'preço de venda': 'salePrice',
  venda: 'salePrice',
  atacado: 'wholesalePrice',
  'preco de atacado': 'wholesalePrice',
  'preço de atacado': 'wholesalePrice',
  fornecedor: 'supplier',
  imei: 'imei',
  'numero de serie': 'serialNumber',
  'número de série': 'serialNumber',
  serie: 'serialNumber',
  'saude da bateria': 'batteryHealth',
  'saúde da bateria': 'batteryHealth',
  bateria: 'batteryHealth',
  lote: 'lote',
  condicao: 'condicao',
  condição: 'condicao',
  estado: 'condicao',
  'lote da caixa': 'lote',
  'codigo de barras': 'barcode',
  'código de barras': 'barcode',
  observacoes: 'notes',
  observações: 'notes',
  obs: 'notes',
};

const semAcento = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

function paraNumero(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function textoDaCelula(celula: ExcelJS.Cell): string {
  const v = celula.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
}

const planilhaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, arquivo, cb) => {
    if (!/\.(xlsx|xls|csv)$/i.test(arquivo.originalname)) {
      return cb(new AppError('Envie um arquivo .xlsx, .xls ou .csv'));
    }
    cb(null, true);
  },
});

rotasSistema.get(
  '/import/template',
  rota(async (_req, res) => {
    const arquivo = new ExcelJS.Workbook();
    const aba = arquivo.addWorksheet('Produtos');

    aba.columns = CABECALHOS.map((h) => ({ header: h, key: h, width: 20 }));
    aba.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    aba.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    aba.addRow([
      'Smartphones',
      'iPhone 13',
      'Apple',
      '13',
      'Meia-noite',
      '128GB',
      1,
      3200,
      4199,
      3950,
      'Fornecedor Exemplo',
      '356938035643809',
      '',
      '89',
      '',
      'Novo / Lacrado',
      'Exemplo — apague esta linha',
    ]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-produtos.xlsx"');
    await arquivo.xlsx.write(res);
    res.end();
  }),
);

rotasSistema.post(
  '/import/products',
  somenteAdmin,
  planilhaUpload.single('file'),
  rota(async (req, res) => {
    if (!req.file) throw new AppError('Envie a planilha no campo "file"');

    const arquivo = new ExcelJS.Workbook();
    if (req.file.originalname.toLowerCase().endsWith('.csv')) {
      await arquivo.csv.read(Readable.from(req.file.buffer.toString('utf8')));
    } else {
      await arquivo.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    }

    const aba = arquivo.worksheets[0];
    if (!aba) throw new AppError('A planilha está vazia');

    const colunas = new Map<number, string>();
    aba.getRow(1).eachCell((celula, indice) => {
      const campo = DE_PARA[textoDaCelula(celula).toLowerCase().replace(/\s+/g, ' ')];
      if (campo) colunas.set(indice, campo);
    });

    if (![...colunas.values()].includes('name')) {
      throw new AppError('Não encontrei a coluna "Nome". Baixe o modelo e mantenha os cabeçalhos.');
    }

    const [categorias, fornecedores] = await Promise.all([
      db.category.findMany(),
      db.supplier.findMany(),
    ]);

    const porCategoria = new Map(categorias.map((c) => [semAcento(c.name), c]));
    categorias.forEach((c) => porCategoria.set(semAcento(c.slug), c));
    const porFornecedor = new Map(fornecedores.map((f) => [semAcento(f.name), f]));

    const unidadeDaImportacao =
      req.usuario?.unidadeId ??
      (await db.unit.findFirst({ where: { active: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }))?.id ??
      null;

    const erros: { row: number; message: string }[] = [];
    let importados = 0;
    let processadas = 0;

    for (let n = 2; n <= aba.rowCount; n += 1) {
      const linha = aba.getRow(n);
      const dados: Record<string, string> = {};
      colunas.forEach((campo, indice) => {
        dados[campo] = textoDaCelula(linha.getCell(indice));
      });

      if (!dados.name) continue;
      processadas += 1;

      const categoria = porCategoria.get(semAcento(dados.category ?? ''));
      if (!categoria) {
        erros.push({
          row: n,
          message: `Categoria "${dados.category || '(vazia)'}" não encontrada. Use: ${categorias.map((c) => c.name).join(', ')}`,
        });
        continue;
      }

      let fornecedorId: string | null = null;
      if (dados.supplier) {
        const chave = semAcento(dados.supplier);
        let fornecedor = porFornecedor.get(chave);
        if (!fornecedor) {
          fornecedor = await db.supplier.create({ data: { name: dados.supplier.trim() } });
          porFornecedor.set(chave, fornecedor);
        }
        fornecedorId = fornecedor.id;
      }

      const quantidade = Math.max(0, Math.trunc(paraNumero(dados.quantity)));
      const temImei = Boolean(dados.imei?.trim());
      const unitario = categoria.tipoControlePadrao === 'UNITARIO' || temImei;
      const bateria = dados.batteryHealth ? Math.round(paraNumero(dados.batteryHealth)) : null;

      try {
        const produto = await db.product.create({
          data: {
            name: dados.name,
            brand: dados.brand || null,
            model: dados.model || null,
            color: dados.color || null,
            capacity: dados.capacity || null,
            ram: dados.ram || null,
            costPrice: paraNumero(dados.costPrice),
            salePrice: paraNumero(dados.salePrice),
            wholesalePrice: dados.wholesalePrice ? paraNumero(dados.wholesalePrice) : null,
            imei: unitario ? null : dados.imei || null,
            serialNumber: unitario ? null : dados.serialNumber || null,
            lote: dados.lote || null,
            condicao: dados.condicao || null,
            barcode: dados.barcode || null,
            notes: dados.notes || null,
            tipoControle: unitario ? 'UNITARIO' : 'QUANTIDADE',
            categoryId: categoria.id,
            supplierId: fornecedorId,
          },
        });

        if (unidadeDaImportacao) {
          if (unitario) {
            // Uma linha da planilha = um aparelho. Quantidade > 1 sem IMEI
            // vira N aparelhos sem IMEI, para o saldo bater.
            const total = Math.max(1, quantidade || 1);
            for (let k = 0; k < total; k += 1) {
              await db.deviceUnit.create({
                data: {
                  productId: produto.id,
                  unitId: unidadeDaImportacao,
                  imei: k === 0 && temImei ? dados.imei.trim() : null,
                  serialNumber: k === 0 && dados.serialNumber ? dados.serialNumber.trim() : null,
                  batteryHealth: bateria,
                  condicao: dados.condicao || null,
                  costPrice: paraNumero(dados.costPrice),
                  status: 'EM_ESTOQUE',
                },
              });
            }
            await db.$transaction((tx) => sincronizarSaldoUnitario(produto.id, unidadeDaImportacao, tx));
            await db.stockMovement.create({
              data: {
                type: 'ENTRADA',
                reason: 'CADASTRO',
                quantity: total,
                previousQuantity: 0,
                newQuantity: total,
                productId: produto.id,
                productName: produto.name,
                unitId: unidadeDaImportacao,
                userId: req.usuario?.id ?? null,
                notes: 'Importação de planilha',
              },
            });
          } else if (quantidade > 0) {
            await movimentar({
              produtoId: produto.id,
              produtoNome: produto.name,
              unidadeId: unidadeDaImportacao,
              tipo: 'ENTRADA',
              motivo: 'CADASTRO',
              quantidade,
              observacao: 'Importação de planilha',
              usuarioId: req.usuario?.id,
              usuarioNome: req.usuario?.nome,
            });
          }
        }

        importados += 1;
      } catch (erro) {
        erros.push({ row: n, message: (erro as Error).message });
      }
    }

    await registrarLog({
      acao: 'IMPORT',
      entidade: 'Product',
      alteracoes: { importados, erros: erros.length },
      req,
    });

    res.json({
      dryRun: false,
      processed: processadas,
      imported: importados,
      errors: erros,
      message: `${importados} produto(s) importados com sucesso.`,
    });
  }),
);

// ------------------------------------------------------- Taxas do cartão

const CHAVE_TAXAS = 'taxas_cartao';

export async function taxasDoCartao(): Promise<TaxaDeCartao[]> {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_TAXAS } });
  if (!guardado) return TAXAS_PADRAO;

  try {
    return normalizarTaxas(JSON.parse(guardado.value));
  } catch {
    return TAXAS_PADRAO;
  }
}

rotasSistema.get(
  '/taxas-cartao',
  rota(async (_req, res) => {
    res.json({ taxas: await taxasDoCartao(), padrao: TAXAS_PADRAO });
  }),
);

rotasSistema.put(
  '/taxas-cartao',
  somenteAdmin,
  rota(async (req, res) => {
    const { taxas } = validar(
      z.object({
        taxas: z
          .array(
            z.object({
              parcelas: z.coerce.number().int().min(1).max(24),
              padrao: z.coerce.number().min(0).max(99.99),
              elo: z.coerce.number().min(0).max(99.99).optional().nullable(),
            }),
          )
          .min(1, 'Informe ao menos uma linha')
          .max(24),
      }),
      req.body,
    );

    const limpas = normalizarTaxas(taxas);

    await db.setting.upsert({
      where: { key: CHAVE_TAXAS },
      update: { value: JSON.stringify(limpas) },
      create: { key: CHAVE_TAXAS, value: JSON.stringify(limpas) },
    });

    await registrarLog({ acao: 'TAXAS_CARTAO', entidade: 'Setting', id: CHAVE_TAXAS, req });
    res.json({ taxas: limpas, message: `${limpas.length} faixa(s) de parcelamento salvas.` });
  }),
);

// ------------------------------------------------------------ Dados da loja

const CHAVE_LOJA = 'dados_da_loja';

export async function lojaSalva(): Promise<DadosDaLoja> {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_LOJA } });
  if (!guardado) return LOJA_PADRAO;
  try {
    return normalizarLoja(JSON.parse(guardado.value));
  } catch {
    return LOJA_PADRAO;
  }
}

rotasSistema.get(
  '/loja',
  rota(async (_req, res) => {
    res.json(await lojaSalva());
  }),
);

rotasSistema.put(
  '/loja',
  somenteAdmin,
  rota(async (req, res) => {
    const dados = validar(
      z.object({
        nome: z.string().trim().min(2, 'Informe o nome da loja').max(120),
        documento: z.string().trim().max(30).optional(),
        endereco: z.string().trim().max(160).optional(),
        bairro: z.string().trim().max(80).optional(),
        cidade: z.string().trim().max(80).optional(),
        uf: z.string().trim().max(2).optional(),
        cep: z.string().trim().max(12).optional(),
        telefone: z.string().trim().max(40).optional(),
        email: z.string().trim().max(120).optional(),
        rodape: z.string().trim().max(300).optional(),
      }),
      req.body,
    );

    const loja = normalizarLoja(dados);
    await db.setting.upsert({
      where: { key: CHAVE_LOJA },
      update: { value: JSON.stringify(loja) },
      create: { key: CHAVE_LOJA, value: JSON.stringify(loja) },
    });

    await registrarLog({ acao: 'DADOS_DA_LOJA', entidade: 'Setting', id: CHAVE_LOJA, req });
    res.json({ ...loja, message: 'Dados da loja salvos. Já valem no próximo comprovante.' });
  }),
);

// ------------------------------------------------------- Unidade de venda

const CHAVE_UNIDADE = 'unidade_de_venda';

export async function unidadeDeVenda() {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_UNIDADE } });

  if (guardado) {
    const escolhida = await db.unit.findUnique({ where: { id: guardado.value } });
    if (escolhida?.active) return escolhida;
  }

  return db.unit.findFirst({ where: { active: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
}

rotasSistema.get(
  '/unidade-de-venda',
  rota(async (_req, res) => {
    const unidade = await unidadeDeVenda();
    res.json({ unitId: unidade?.id ?? null, name: unidade?.name ?? null });
  }),
);

rotasSistema.put(
  '/unidade-de-venda',
  somenteAdmin,
  rota(async (req, res) => {
    const { unitId } = validar(z.object({ unitId: z.string().uuid() }), req.body);

    const unidade = await db.unit.findUnique({ where: { id: unitId } });
    if (!unidade) throw new AppError('Unidade não encontrada', 404);
    if (!unidade.active) throw new AppError(`A unidade ${unidade.name} está desativada.`);

    await db.setting.upsert({
      where: { key: CHAVE_UNIDADE },
      update: { value: unitId },
      create: { key: CHAVE_UNIDADE, value: unitId },
    });

    await registrarLog({ acao: 'UNIDADE_DE_VENDA', entidade: 'Setting', id: CHAVE_UNIDADE, req });
    res.json({ unitId, name: unidade.name, message: `As vendas passam a sair da ${unidade.name}.` });
  }),
);

// ---------------------------------------------------------- Contas de Pix

const CHAVE_PIX = 'contas_pix';

export async function contasDePix(): Promise<string[]> {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_PIX } });
  if (!guardado) return [];

  try {
    const lista = JSON.parse(guardado.value);
    return Array.isArray(lista) ? lista.filter((c) => typeof c === 'string' && c.trim()) : [];
  } catch {
    return [];
  }
}

rotasSistema.get(
  '/contas-pix',
  rota(async (_req, res) => {
    res.json({ contas: await contasDePix() });
  }),
);

rotasSistema.put(
  '/contas-pix',
  somenteAdmin,
  rota(async (req, res) => {
    const { contas } = validar(
      z.object({ contas: z.array(z.string().trim().min(1).max(60)).max(12) }),
      req.body,
    );

    const limpas = [...new Set(contas.map((c) => c.trim()).filter(Boolean))];

    await db.setting.upsert({
      where: { key: CHAVE_PIX },
      update: { value: JSON.stringify(limpas) },
      create: { key: CHAVE_PIX, value: JSON.stringify(limpas) },
    });

    await registrarLog({ acao: 'CONTAS_PIX', entidade: 'Setting', id: CHAVE_PIX, req });
    res.json({ contas: limpas, message: `${limpas.length} conta(s) de Pix salvas.` });
  }),
);

// ------------------------------------------------------- Chave de acesso

const CHAVE_ACESSO = 'chave_de_acesso';

export async function conferirChaveDeAcesso(chave?: string | null): Promise<boolean> {
  if (!chave?.trim()) return false;

  const guardada = await db.setting.findUnique({ where: { key: CHAVE_ACESSO } });
  if (!guardada) return false;

  return bcrypt.compare(chave.trim(), guardada.value);
}

export async function temChaveDeAcesso(): Promise<boolean> {
  return Boolean(await db.setting.findUnique({ where: { key: CHAVE_ACESSO } }));
}

rotasSistema.get(
  '/chave-de-acesso',
  rota(async (_req, res) => {
    res.json({ definida: await temChaveDeAcesso() });
  }),
);

rotasSistema.put(
  '/chave-de-acesso',
  somenteAdmin,
  rota(async (req, res) => {
    const { chave } = validar(
      z.object({
        chave: z.string().trim().min(4, 'A chave precisa de ao menos 4 caracteres').max(60),
      }),
      req.body,
    );

    await db.setting.upsert({
      where: { key: CHAVE_ACESSO },
      update: { value: await bcrypt.hash(chave, 10) },
      create: { key: CHAVE_ACESSO, value: await bcrypt.hash(chave, 10) },
    });

    await registrarLog({ acao: 'CHAVE_DE_ACESSO', entidade: 'Setting', id: CHAVE_ACESSO, req });
    res.json({ definida: true, message: 'Chave de acesso salva.' });
  }),
);

rotasSistema.delete(
  '/chave-de-acesso',
  somenteAdmin,
  rota(async (req, res) => {
    await db.setting.deleteMany({ where: { key: CHAVE_ACESSO } });
    await registrarLog({ acao: 'CHAVE_DE_ACESSO_REMOVIDA', entidade: 'Setting', id: CHAVE_ACESSO, req });
    res.json({ definida: false, message: 'Chave removida. Vender abaixo do atacado fica bloqueado.' });
  }),
);

// ------------------------------------------- Emojis da lista de atacado

const CHAVE_EMOJIS = 'emojis_categoria';

export async function emojisDeCategoria(): Promise<Record<string, string>> {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_EMOJIS } });
  if (!guardado) return {};

  try {
    const mapa: unknown = JSON.parse(guardado.value);
    if (!mapa || typeof mapa !== 'object') return {};

    return Object.fromEntries(
      Object.entries(mapa as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'string' && v.trim(),
      ) as [string, string][],
    );
  } catch {
    return {};
  }
}

rotasSistema.get(
  '/emojis-categoria',
  rota(async (_req, res) => {
    res.json({ emojis: await emojisDeCategoria() });
  }),
);

rotasSistema.put(
  '/emojis-categoria',
  somenteAdmin,
  rota(async (req, res) => {
    const { emojis } = validar(
      z.object({
        emojis: z.record(z.string().uuid(), z.string().trim().max(8)),
      }),
      req.body,
    );

    const limpos = Object.fromEntries(Object.entries(emojis).filter(([, v]) => v.trim()));

    await db.setting.upsert({
      where: { key: CHAVE_EMOJIS },
      update: { value: JSON.stringify(limpos) },
      create: { key: CHAVE_EMOJIS, value: JSON.stringify(limpos) },
    });

    await registrarLog({ acao: 'EMOJIS_CATEGORIA', entidade: 'Setting', id: CHAVE_EMOJIS, req });
    res.json({ emojis: limpos, message: 'Emojis da lista salvos.' });
  }),
);

// ------------------------------------------------- Meta dos vendedores

const CHAVE_META = 'meta_de_vendas';

export async function metaDeVendas(): Promise<number> {
  const guardado = await db.setting.findUnique({ where: { key: CHAVE_META } });
  const n = Number(guardado?.value);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

rotasSistema.get(
  '/meta-de-vendas',
  rota(async (_req, res) => {
    res.json({ meta: await metaDeVendas() });
  }),
);

rotasSistema.put(
  '/meta-de-vendas',
  somenteAdmin,
  rota(async (req, res) => {
    const { meta } = validar(
      z.object({ meta: z.coerce.number().int().min(1, 'A meta é de pelo menos 1 aparelho').max(999) }),
      req.body,
    );

    await db.setting.upsert({
      where: { key: CHAVE_META },
      update: { value: String(meta) },
      create: { key: CHAVE_META, value: String(meta) },
    });

    await registrarLog({ acao: 'META_DE_VENDAS', entidade: 'Setting', id: CHAVE_META, req });
    res.json({ meta, message: `Meta de ${meta} aparelhos por dia, por vendedor.` });
  }),
);
