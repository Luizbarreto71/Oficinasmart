import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { PAGAMENTO_LABEL } from './core';
import { linhaDeCidade, linhaDeEndereco, type DadosDaLoja } from '../shared/loja';

const AZUL = '#0F172A';
const CINZA = '#475569';
const BORDA = '#94A3B8';
const FAIXA = '#E2E8F0';
const CLARO = '#F8FAFC';

const dinheiro = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export interface DadosDoRecibo {
  loja: DadosDaLoja;
  code: string;
  saleDate: Date;
  unitName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerDocument?: string | null;
  sellerName?: string | null;
  cashierName?: string | null;
  notes?: string | null;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    imei?: string | null;
    serialNumber?: string | null;
  }[];
  payments: { method: string; amount: number; installments: number }[];
  troca?: { modelo: string; imei?: string | null; valor: number } | null;
  total: number;
}

/** Comprovante de venda em formato de pedido. */
export function enviarRecibo(res: Response, r: DadosDoRecibo): void {
  const doc = new PDFDocument({ margin: 28, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="comprovante-${r.code}.pdf"`);
  doc.pipe(res);

  const x0 = doc.page.margins.left;
  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const PAD = 6;

  const quadro = (y: number, altura: number, preenchimento?: string) => {
    if (preenchimento) doc.rect(x0, y, largura, altura).fill(preenchimento);
    doc.rect(x0, y, largura, altura).lineWidth(0.7).strokeColor(BORDA).stroke();
  };

  const secao = (titulo: string) => {
    const y = doc.y;
    quadro(y, 16, FAIXA);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(8).text(titulo, x0 + PAD, y + 4.5, {
      lineBreak: false,
    });
    doc.y = y + 16;
  };

  const alturaTopo = 56;
  let y = doc.y;
  quadro(y, alturaTopo);

  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(13).text(r.loja.nome.toUpperCase(), x0 + PAD, y + 8, {
    width: largura * 0.55,
    lineBreak: false,
  });

  doc.font('Helvetica').fontSize(8).fillColor(CINZA);
  let linhaY = y + 25;
  for (const texto of [
    linhaDeEndereco(r.loja),
    linhaDeCidade(r.loja),
    r.loja.documento && `CNPJ/CPF: ${r.loja.documento}`,
  ]) {
    if (!texto) continue;
    doc.text(texto, x0 + PAD, linhaY, { width: largura * 0.55, lineBreak: false });
    linhaY += 10;
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(AZUL);
  let direitaY = y + 9;
  for (const texto of [r.loja.telefone, r.loja.email]) {
    if (!texto) continue;
    doc.text(texto, x0, direitaY, { width: largura - PAD, align: 'right', lineBreak: false });
    direitaY += 10;
  }
  doc
    .font('Helvetica')
    .fillColor(CINZA)
    .text(`Vendedor: ${r.sellerName?.trim() || '—'}`, x0, direitaY, {
      width: largura - PAD,
      align: 'right',
      lineBreak: false,
    });

  doc.y = y + alturaTopo;

  y = doc.y;
  quadro(y, 20, CLARO);
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(11).text(`COMPROVANTE Nº ${r.code}`, x0, y + 5.5, {
    width: largura,
    align: 'center',
    lineBreak: false,
  });
  doc.fontSize(9).text(dataBR(r.saleDate), x0, y + 6.5, {
    width: largura - PAD,
    align: 'right',
    lineBreak: false,
  });
  doc.y = y + 20;

  secao('DADOS DO CLIENTE');

  const linhaDeCampos = (pares: [string, string][]) => {
    const yl = doc.y;
    quadro(yl, 16);

    const metade = largura / 2;
    pares.slice(0, 2).forEach(([rotulo, valor], i) => {
      const cx = x0 + i * metade;
      if (i === 1) {
        doc.moveTo(cx, yl).lineTo(cx, yl + 16).lineWidth(0.7).strokeColor(BORDA).stroke();
      }
      doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8).text(rotulo, cx + PAD, yl + 4.5, {
        width: 70,
        lineBreak: false,
      });
      doc.fillColor(AZUL).font('Helvetica').text(valor || '—', cx + PAD + 72, yl + 4.5, {
        width: metade - 72 - PAD * 2,
        lineBreak: false,
        ellipsis: true,
      });
    });
    doc.y = yl + 16;
  };

  linhaDeCampos([
    ['Cliente:', r.customerName?.trim() || 'Consumidor não identificado'],
    ['CPF/CNPJ:', r.customerDocument ?? ''],
  ]);
  linhaDeCampos([
    ['Telefone:', r.customerPhone ?? ''],
    ['Loja:', r.unitName ?? ''],
  ]);

  doc.y += 6;

  secao('PRODUTOS');

  const colunas = [
    { titulo: 'ITEM', peso: 6, alinhar: 'center' as const },
    { titulo: 'NOME', peso: 46 },
    { titulo: 'UND.', peso: 8, alinhar: 'center' as const },
    { titulo: 'QTD.', peso: 9, alinhar: 'right' as const },
    { titulo: 'VR. UNIT.', peso: 15, alinhar: 'right' as const },
    { titulo: 'SUBTOTAL', peso: 16, alinhar: 'right' as const },
  ];
  const peso = colunas.reduce((s, c) => s + c.peso, 0);
  const larguras = colunas.map((c) => (c.peso / peso) * largura);

  const linhaDaTabela = (
    valores: string[],
    altura: number,
    opcoes?: { negrito?: boolean; fundo?: string; subtexto?: string },
  ) => {
    const yl = doc.y;
    quadro(yl, altura, opcoes?.fundo);

    let x = x0;
    colunas.forEach((c, i) => {
      if (i > 0) {
        doc.moveTo(x, yl).lineTo(x, yl + altura).lineWidth(0.7).strokeColor(BORDA).stroke();
      }
      doc
        .fillColor(opcoes?.negrito ? AZUL : '#1E293B')
        .font(opcoes?.negrito ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .text(valores[i] ?? '', x + 4, yl + 4.5, {
          width: larguras[i] - 8,
          align: c.alinhar ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
      x += larguras[i];
    });

    if (opcoes?.subtexto) {
      doc
        .fillColor(CINZA)
        .font('Helvetica')
        .fontSize(6.5)
        .text(opcoes.subtexto, x0 + larguras[0] + 4, yl + 14, {
          width: larguras[1] - 8,
          lineBreak: false,
          ellipsis: true,
        });
    }

    doc.y = yl + altura;
  };

  linhaDaTabela(colunas.map((c) => c.titulo), 16, { negrito: true, fundo: FAIXA });

  r.items.forEach((item, i) => {
    const identificador = [item.imei && `IMEI ${item.imei}`, item.serialNumber && `Nº ${item.serialNumber}`]
      .filter(Boolean)
      .join(' · ');

    if (doc.y > doc.page.height - doc.page.margins.bottom - 150) doc.addPage();

    linhaDaTabela(
      [
        String(i + 1),
        item.productName,
        'UN',
        dinheiro(item.quantity),
        dinheiro(item.unitPrice),
        dinheiro(item.unitPrice * item.quantity),
      ],
      identificador ? 24 : 16,
      { subtexto: identificador || undefined },
    );
  });

  const pecas = r.items.reduce((s, i) => s + i.quantity, 0);
  const somaDosItens = r.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  linhaDaTabela(['', 'TOTAL', '', dinheiro(pecas), '', dinheiro(somaDosItens)], 16, {
    negrito: true,
    fundo: FAIXA,
  });

  doc.y += 4;
  const totalDireita = (rotulo: string, valor: string, grande = false) => {
    const yl = doc.y;
    doc
      .fillColor(AZUL)
      .font('Helvetica-Bold')
      .fontSize(grande ? 11 : 9)
      .text(`${rotulo} ${valor}`, x0, yl, { width: largura - PAD, align: 'right', lineBreak: false });
    doc.y = yl + (grande ? 16 : 12);
  };

  totalDireita('PRODUTOS:', dinheiro(somaDosItens));
  totalDireita('TOTAL:', `R$ ${dinheiro(r.total)}`, true);

  doc.y += 4;

  secao('DADOS DO PAGAMENTO');

  const colsPag = [
    { titulo: 'DATA', peso: 16 },
    { titulo: 'VALOR', peso: 16, alinhar: 'right' as const },
    { titulo: 'FORMA DE PAGAMENTO', peso: 30 },
    { titulo: 'OBSERVAÇÃO', peso: 38 },
  ];
  const pesoPag = colsPag.reduce((s, c) => s + c.peso, 0);
  const largsPag = colsPag.map((c) => (c.peso / pesoPag) * largura);

  const linhaPag = (valores: string[], negrito = false, fundo?: string) => {
    const yl = doc.y;
    quadro(yl, 16, fundo);

    let x = x0;
    colsPag.forEach((c, i) => {
      if (i > 0) {
        doc.moveTo(x, yl).lineTo(x, yl + 16).lineWidth(0.7).strokeColor(BORDA).stroke();
      }
      doc
        .fillColor(negrito ? AZUL : '#1E293B')
        .font(negrito ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .text(valores[i] ?? '', x + 4, yl + 4.5, {
          width: largsPag[i] - 8,
          align: c.alinhar ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
      x += largsPag[i];
    });
    doc.y = yl + 16;
  };

  linhaPag(colsPag.map((c) => c.titulo), true, FAIXA);

  for (const p of r.payments) {
    const forma = PAGAMENTO_LABEL[p.method] ?? p.method;
    const observacao =
      p.method === 'TROCA' && r.troca
        ? [r.troca.modelo, r.troca.imei && `IMEI ${r.troca.imei}`].filter(Boolean).join(' · ')
        : '';

    linhaPag([
      dataBR(r.saleDate),
      dinheiro(p.amount),
      p.installments > 1 ? `${forma} — ${p.installments}x de ${dinheiro(p.amount / p.installments)}` : forma,
      observacao,
    ]);
  }

  if (r.notes?.trim()) {
    doc.y += 6;
    secao('OBSERVAÇÕES');
    const yl = doc.y;
    const alturaObs = Math.max(20, doc.heightOfString(r.notes.trim(), { width: largura - PAD * 2 }) + 9);
    quadro(yl, alturaObs);
    doc.fillColor('#1E293B').font('Helvetica').fontSize(8).text(r.notes.trim(), x0 + PAD, yl + 5, {
      width: largura - PAD * 2,
    });
    doc.y = yl + alturaObs;
  }

  doc.y += 14;
  const yAss = doc.y;
  quadro(yAss, 44);
  doc
    .moveTo(x0 + largura * 0.25, yAss + 26)
    .lineTo(x0 + largura * 0.75, yAss + 26)
    .lineWidth(0.7)
    .strokeColor(AZUL)
    .stroke();
  doc.fillColor(CINZA).font('Helvetica').fontSize(8).text('Assinatura do cliente', x0, yAss + 30, {
    width: largura,
    align: 'center',
    lineBreak: false,
  });
  doc.y = yAss + 44;

  doc.y += 8;
  doc
    .fillColor(CINZA)
    .fontSize(7)
    .font('Helvetica')
    .text(
      [
        r.loja.rodape,
        'Documento sem valor fiscal, emitido para controle interno e comprovação de compra. ' +
          'Guarde este comprovante para qualquer atendimento de garantia ou troca.',
      ]
        .filter(Boolean)
        .join('\n'),
      x0,
      doc.y,
      { width: largura, align: 'center' },
    );

  doc.end();
}
