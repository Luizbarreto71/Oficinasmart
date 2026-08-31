import type { sheets_v4 } from 'googleapis';

/**
 * Integração opcional com o Google Sheets.
 *
 * Cada entrada, venda, alteração ou exclusão vira uma linha na planilha.
 * O envio é "dispare e esqueça": se a planilha falhar, o sistema segue
 * funcionando e só registra o erro no log.
 */

export interface Linha {
  data: Date | string;
  produto: string;
  categoria: string;
  unidade: string;
  tipo: string;
  quantidade: number;
  estoqueAnterior: number;
  estoquePosterior: number;
  origem?: string | null;
  destino?: string | null;
  usuario?: string | null;
  motivo?: string | null;
  observacao?: string | null;
  movimentoId: string;
}

const CABECALHO = [
  'Data',
  'Hora',
  'Produto',
  'Categoria',
  'Unidade',
  'Tipo de movimentação',
  'Quantidade',
  'Estoque anterior',
  'Estoque posterior',
  'Origem',
  'Destino',
  'Usuário responsável',
  'Motivo',
  'Observação',
  'ID da movimentação',
];

const conf = () => ({
  ativo: process.env.GOOGLE_SHEETS_ENABLED === 'true',
  planilha: process.env.GOOGLE_SHEETS_ID ?? '',
  aba: process.env.GOOGLE_SHEETS_TAB ?? 'Movimentacoes',
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
  chave: (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
});

export function planilhaConfigurada(): boolean {
  const c = conf();
  return Boolean(c.ativo && c.planilha && c.email && c.chave);
}

export const statusPlanilha = () => {
  const c = conf();
  return {
    enabled: c.ativo,
    configured: planilhaConfigurada(),
    spreadsheetId: c.planilha || null,
    sheetName: c.aba,
  };
};

let cliente: sheets_v4.Sheets | null = null;
let cabecalhoOk = false;

async function conectar(): Promise<sheets_v4.Sheets | null> {
  if (!planilhaConfigurada()) return null;
  if (cliente) return cliente;

  const c = conf();
  const { google } = await import('googleapis');

  cliente = google.sheets({
    version: 'v4',
    auth: new google.auth.JWT({
      email: c.email,
      key: c.chave,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    }),
  });
  return cliente;
}

const valores = (l: Linha) => {
  const quando = new Date(l.data);
  const emSP = (opcoes: Intl.DateTimeFormatOptions) =>
    quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes });

  return [
    emSP({ day: '2-digit', month: '2-digit', year: 'numeric' }),
    emSP({ hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    l.produto,
    l.categoria,
    l.unidade,
    l.tipo,
    l.quantidade,
    l.estoqueAnterior,
    l.estoquePosterior,
    l.origem ?? '',
    l.destino ?? '',
    l.usuario ?? '',
    l.motivo ?? '',
    l.observacao ?? '',
    l.movimentoId,
  ];
};

async function prepararAba(sheets: sheets_v4.Sheets): Promise<void> {
  if (cabecalhoOk) return;
  const c = conf();

  const info = await sheets.spreadsheets.get({ spreadsheetId: c.planilha });
  const existe = info.data.sheets?.some((s) => s.properties?.title === c.aba);

  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: c.planilha,
      requestBody: { requests: [{ addSheet: { properties: { title: c.aba } } }] },
    });
  }

  const atual = await sheets.spreadsheets.values.get({
    spreadsheetId: c.planilha,
    range: `${c.aba}!A1:O1`,
  });

  if (!atual.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: c.planilha,
      range: `${c.aba}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CABECALHO] },
    });
  }

  cabecalhoOk = true;
}

/** Acrescenta linhas sem travar quem chamou. */
export function enviarParaPlanilha(linhas: Linha | Linha[]): void {
  const lista = Array.isArray(linhas) ? linhas : [linhas];
  if (!lista.length) return;

  void (async () => {
    const sheets = await conectar();
    if (!sheets) return;
    const c = conf();

    try {
      await prepararAba(sheets);
      await sheets.spreadsheets.values.append({
        spreadsheetId: c.planilha,
        range: `${c.aba}!A:O`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: lista.map(valores) },
      });
    } catch (erro) {
      console.error('[planilha] falha ao sincronizar:', (erro as Error).message);
    }
  })();
}

/** Reescreve a planilha inteira a partir do histórico do banco. */
export async function reescreverPlanilha(linhas: Linha[]): Promise<number> {
  const sheets = await conectar();
  if (!sheets) throw new Error('Integração com Google Sheets não configurada');
  const c = conf();

  await prepararAba(sheets);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: c.planilha,
    range: `${c.aba}!A2:O`,
  });

  if (linhas.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: c.planilha,
      range: `${c.aba}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: linhas.map(valores) },
    });
  }

  return linhas.length;
}
