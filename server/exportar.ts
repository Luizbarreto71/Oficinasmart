import ExcelJS from 'exceljs';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';

/** Motor genérico de exportação: os relatórios só descrevem colunas e linhas. */

export interface Coluna {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (valor: unknown) => string | number;
}

export interface Relatorio {
  title: string;
  subtitle?: string;
  columns: Coluna[];
  rows: Record<string, unknown>[];
  summary?: { label: string; value: string }[];
  group?: {
    key: string;
    totals?: string[];
    order?: string[];
  };
}

function agrupar(r: Relatorio): { titulo: string; linhas: Record<string, unknown>[] }[] {
  if (!r.group) return [{ titulo: '', linhas: r.rows }];

  const mapa = new Map<string, Record<string, unknown>[]>();
  for (const linha of r.rows) {
    const chave = String(linha[r.group.key] ?? '—') || '—';
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(linha);
  }

  const ordem = r.group.order ?? [];
  return [...mapa.entries()]
    .sort(([a], [b]) => {
      const ia = ordem.indexOf(a);
      const ib = ordem.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b, 'pt-BR');
    })
    .map(([titulo, linhas]) => ({ titulo, linhas }));
}

const somarBloco = (linhas: Record<string, unknown>[], chaves: string[]) =>
  Object.fromEntries(chaves.map((k) => [k, linhas.reduce((s, l) => s + (Number(l[k]) || 0), 0)]));

const AZUL = '#0F172A';

const valorDaCelula = (c: Coluna, linha: Record<string, unknown>): string | number => {
  const bruto = linha[c.key];
  if (c.format) return c.format(bruto);
  if (bruto === null || bruto === undefined) return '';
  if (bruto instanceof Date) return bruto.toLocaleDateString('pt-BR');
  return typeof bruto === 'number' ? bruto : String(bruto);
};

function nomeDoArquivo(titulo: string, ext: string): string {
  const data = new Date().toISOString().slice(0, 10);
  const apelido = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${apelido}-${data}.${ext}`;
}

// --------------------------------------------------------------------- CSV

function enviarCsv(res: Response, r: Relatorio): void {
  const escapar = (v: string | number) => {
    const texto = String(v ?? '');
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const linhas = [r.columns.map((c) => escapar(c.header)).join(';')];

  for (const bloco of agrupar(r)) {
    if (bloco.titulo) {
      linhas.push('');
      linhas.push(escapar(`${bloco.titulo.toUpperCase()} (${bloco.linhas.length})`));
    }

    for (const linha of bloco.linhas) {
      linhas.push(r.columns.map((c) => escapar(valorDaCelula(c, linha))).join(';'));
    }

    if (bloco.titulo && r.group?.totals?.length) {
      const somas = somarBloco(bloco.linhas, r.group.totals);
      linhas.push(
        r.columns
          .map((c, i) =>
            r.group!.totals!.includes(c.key)
              ? escapar(String(c.format ? c.format(somas[c.key]) : somas[c.key]))
              : i === 0
                ? escapar(`Total ${bloco.titulo}`)
                : '',
          )
          .join(';'),
      );
    }
  }

  if (r.summary?.length) {
    linhas.push('');
    r.summary.forEach((s) => linhas.push(`${escapar(s.label)};${escapar(s.value)}`));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo(r.title, 'csv')}"`);
  res.send(`﻿${linhas.join('\n')}`);
}

// ------------------------------------------------------------------- Excel

async function enviarExcel(res: Response, r: Relatorio): Promise<void> {
  const planilha = new ExcelJS.Workbook();
  planilha.creator = 'Oficina do Smartphone';
  planilha.created = new Date();

  const aba = planilha.addWorksheet(r.title.slice(0, 30) || 'Relatório', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  aba.columns = r.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(14, c.header.length + 4),
  }));

  aba.getRow(1).eachCell((celula) => {
    celula.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    celula.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  aba.getRow(1).height = 22;

  const titulos: number[] = [];
  const subtotais: number[] = [];

  for (const bloco of agrupar(r)) {
    if (bloco.titulo) {
      const linha = aba.addRow({
        [r.columns[0].key]: `${bloco.titulo.toUpperCase()} — ${bloco.linhas.length} item(ns)`,
      });
      titulos.push(linha.number);
    }

    for (const linha of bloco.linhas) {
      aba.addRow(Object.fromEntries(r.columns.map((c) => [c.key, valorDaCelula(c, linha)])));
    }

    if (bloco.titulo && r.group?.totals?.length) {
      const somas = somarBloco(bloco.linhas, r.group.totals);
      const linha = aba.addRow(
        Object.fromEntries(
          r.columns.map((c, i) => [
            c.key,
            r.group!.totals!.includes(c.key)
              ? (c.format ? c.format(somas[c.key]) : somas[c.key])
              : i === 0
                ? `Total ${bloco.titulo}`
                : '',
          ]),
        ),
      );
      subtotais.push(linha.number);
    }
  }

  aba.eachRow((linha, indice) => {
    if (indice === 1) return;

    if (titulos.includes(indice)) {
      linha.eachCell((celula) => {
        celula.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      });
      return;
    }

    if (subtotais.includes(indice)) {
      linha.eachCell((celula) => {
        celula.font = { bold: true };
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      });
      return;
    }

    linha.eachCell((celula) => {
      celula.alignment = { vertical: 'middle' };
      if (indice % 2 === 0) {
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    });
  });

  if (!r.group) {
    aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: r.columns.length } };
  }

  if (r.summary?.length) {
    aba.addRow([]);
    r.summary.forEach((s) => {
      aba.addRow([s.label, s.value]).getCell(1).font = { bold: true };
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo(r.title, 'xlsx')}"`);

  await planilha.xlsx.write(res);
  res.end();
}

// --------------------------------------------------------------------- PDF

const PADDING = 5;
const ALTURA_MINIMA = 17;

function enviarPdf(res: Response, entrada: Relatorio): void {
  const r: Relatorio = entrada.group
    ? { ...entrada, columns: entrada.columns.filter((c) => c.key !== entrada.group!.key) }
    : entrada;

  const doc = new PDFDocument({
    margin: 30,
    size: 'A4',
    layout: 'landscape',
    bufferPages: true,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo(r.title, 'pdf')}"`);
  doc.pipe(res);

  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  const rodapeY = doc.page.height - doc.page.margins.bottom - 14;

  const larguras = (() => {
    const cabecalhos = r.columns.map((c) => c.header.toUpperCase());

    const largoNoCabecalho = (t: string) => {
      doc.font('Helvetica-Bold').fontSize(7.5);
      return doc.widthOfString(t);
    };
    const largoNaLinha = (t: string) => {
      doc.font('Helvetica').fontSize(8);
      return doc.widthOfString(t);
    };

    const celulas = r.columns.map((c) => r.rows.map((linha) => String(valorDaCelula(c, linha) ?? '')));

    const piso = r.columns.map((_, i) => {
      const doTitulo = cabecalhos[i].split(/\s+/).reduce((m, w) => Math.max(m, largoNoCabecalho(w)), 0);
      const daLinha = celulas[i]
        .flatMap((t) => t.split(/\s+/))
        .reduce((m, w) => Math.max(m, largoNaLinha(w)), 0);
      return Math.max(doTitulo, daLinha) + PADDING * 2 + 1;
    });

    const ideal = r.columns.map((_, i) => {
      const maior = Math.max(largoNoCabecalho(cabecalhos[i]), ...celulas[i].map(largoNaLinha), 0);
      return Math.min(Math.max(maior + PADDING * 2 + 1, piso[i]), largura * 0.22);
    });

    const somaPiso = piso.reduce((a, b) => a + b, 0);
    const somaIdeal = ideal.reduce((a, b) => a + b, 0);

    if (somaIdeal <= largura) return ideal.map((v) => (v / somaIdeal) * largura);

    if (somaPiso <= largura) {
      const folga = largura - somaPiso;
      const fome = ideal.map((v, i) => Math.max(0, v - piso[i]));
      const somaFome = fome.reduce((a, b) => a + b, 0) || 1;
      return piso.map((v, i) => v + (fome[i] / somaFome) * folga);
    }

    return piso.map((v) => (v / somaPiso) * largura);
  })();

  const marca = () => {
    doc.rect(0, 0, doc.page.width, 66).fill(AZUL);
    doc.fillColor('#FFFFFF').fontSize(17).font('Helvetica-Bold').text('Oficina do Smartphone', x0, 16);
    doc.fontSize(10).font('Helvetica').text(r.title, x0, 39);
    doc.fontSize(8).fillColor('#CBD5E1').text(`Gerado em ${dataHora()}`, x0, 40, {
      width: largura,
      align: 'right',
    });
    doc.fillColor(AZUL);
  };

  const alturaDoTexto = (texto: string, i: number) =>
    doc.heightOfString(texto, { width: larguras[i] - PADDING * 2, align: r.columns[i].align ?? 'left' });

  const faixaDeTitulos = () => {
    doc.font('Helvetica-Bold').fontSize(7.5);

    const titulos = r.columns.map((c) => c.header.toUpperCase());
    const altura = Math.max(18, ...titulos.map((t, i) => alturaDoTexto(t, i) + PADDING * 2));

    const y = doc.y;
    doc.rect(x0, y, largura, altura).fill('#E2E8F0');
    doc.fillColor(AZUL);

    let x = x0;
    titulos.forEach((t, i) => {
      doc.text(t, x + PADDING, y + PADDING, {
        width: larguras[i] - PADDING * 2,
        align: r.columns[i].align ?? 'left',
      });
      x += larguras[i];
    });

    doc.y = y + altura;
  };

  const abrirPagina = (primeira: boolean) => {
    if (!primeira) doc.addPage();
    marca();
    doc.y = 80;

    if (r.subtitle) {
      doc.fontSize(9).font('Helvetica').fillColor('#475569').text(r.subtitle, x0, doc.y, { width: largura });
      doc.y += 6;
    }

    faixaDeTitulos();
  };

  const blocos = agrupar(r);

  abrirPagina(true);

  const desenharLinha = (linha: Record<string, unknown>, indice: number) => {
    doc.font('Helvetica').fontSize(8);

    const textos = r.columns.map((c) => String(valorDaCelula(c, linha) ?? ''));
    const altura = Math.max(ALTURA_MINIMA, ...textos.map((t, i) => alturaDoTexto(t, i) + PADDING * 2));

    if (doc.y + altura > rodapeY - 10) {
      abrirPagina(false);
      doc.font('Helvetica').fontSize(8);
    }

    const y = doc.y;
    if (indice % 2 === 1) doc.rect(x0, y, largura, altura).fill('#F8FAFC');

    doc.fillColor('#1E293B');
    let x = x0;
    textos.forEach((t, i) => {
      doc.text(t, x + PADDING, y + PADDING, {
        width: larguras[i] - PADDING * 2,
        align: r.columns[i].align ?? 'left',
      });
      x += larguras[i];
    });

    doc
      .moveTo(x0, y + altura)
      .lineTo(x0 + largura, y + altura)
      .lineWidth(0.5)
      .strokeColor('#E2E8F0')
      .stroke();

    doc.y = y + altura;
  };

  for (const bloco of blocos) {
    if (bloco.titulo) {
      if (doc.y + 46 > rodapeY - 10) abrirPagina(false);

      doc.y += 8;
      const y = doc.y;
      doc.rect(x0, y, largura, 20).fill(AZUL);
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(bloco.titulo.toUpperCase(), x0 + PADDING, y + 6, { lineBreak: false });
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`${bloco.linhas.length} ${bloco.linhas.length === 1 ? 'item' : 'itens'}`, x0, y + 6, {
          width: largura - PADDING,
          align: 'right',
          lineBreak: false,
        });
      doc.y = y + 20;
    }

    bloco.linhas.forEach(desenharLinha);

    if (bloco.titulo && r.group?.totals?.length) {
      const somas = somarBloco(bloco.linhas, r.group.totals);
      if (doc.y + 18 > rodapeY - 10) abrirPagina(false);

      const y = doc.y;
      doc.rect(x0, y, largura, 18).fill('#E2E8F0');
      doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(8);

      const primeiroTotal = r.columns.findIndex((c) => r.group!.totals!.includes(c.key));
      const larguraDoRotulo = larguras
        .slice(0, primeiroTotal === -1 ? larguras.length : primeiroTotal)
        .reduce((a, b) => a + b, 0);

      doc.text(`Total · ${bloco.titulo}`, x0 + PADDING, y + 5, {
        width: Math.max(60, larguraDoRotulo - PADDING * 2),
        lineBreak: false,
        ellipsis: true,
      });

      let x = x0;
      r.columns.forEach((c, i) => {
        if (r.group!.totals!.includes(c.key)) {
          doc.text(String(c.format ? c.format(somas[c.key]) : somas[c.key]), x + PADDING, y + 5, {
            width: larguras[i] - PADDING * 2,
            align: c.align ?? 'right',
            lineBreak: false,
            ellipsis: true,
          });
        }
        x += larguras[i];
      });
      doc.y = y + 18;
    }
  }

  if (r.summary?.length) {
    const alturaResumo = 26 + Math.ceil(r.summary.length / 3) * 16;
    if (doc.y + alturaResumo > rodapeY - 10) abrirPagina(false);

    doc.y += 12;
    const y = doc.y;

    doc.rect(x0, y, largura, alturaResumo).fill('#F1F5F9');
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(9).text('Resumo', x0 + PADDING, y + 7);

    const colunas = 3;
    const larguraItem = (largura - PADDING * 2) / colunas;

    r.summary.forEach((item, i) => {
      const cx = x0 + PADDING + (i % colunas) * larguraItem;
      const cy = y + 24 + Math.floor(i / colunas) * 16;

      doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(`${item.label}: `, cx, cy, {
        width: larguraItem - 6,
        continued: true,
      });
      doc.font('Helvetica-Bold').fillColor(AZUL).text(item.value);
    });

    doc.y = y + alturaResumo;
  }

  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i += 1) {
    doc.switchToPage(paginas.start + i);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#94A3B8')
      .text(`${r.title} · página ${i + 1} de ${paginas.count}`, x0, rodapeY, {
        width: largura,
        align: 'center',
        lineBreak: false,
      });
  }

  doc.flushPages();
  doc.end();
}

const dataHora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export async function exportar(res: Response, formato: string, r: Relatorio): Promise<void> {
  if (formato === 'pdf') return enviarPdf(res, r);
  if (formato === 'csv') return enviarCsv(res, r);
  if (formato === 'xlsx' || formato === 'excel') return enviarExcel(res, r);
  res.json(r);
}

// ------------------------------------------------------------- Formatadores

export const reais = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const decimal = (v: unknown) => Number(v ?? 0).toFixed(2).replace('.', ',');
