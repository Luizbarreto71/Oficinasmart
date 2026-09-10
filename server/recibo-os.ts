import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { PAGAMENTO_LABEL } from './core.js';
import { linhaDeCidade, linhaDeEndereco, type DadosDaLoja } from '../shared/loja.js';

/**
 * Comprovante da Ordem de Serviço, em dois formatos:
 *
 * - `entrada`: o que a loja entrega ao cliente quando recebe o aparelho —
 *   estado de entrada, checklist, problema relatado e previsão de orçamento.
 * - `servico`: o comprovante da retirada — peças, mão de obra, total pago,
 *   forma de pagamento e o termo de garantia do serviço.
 *
 * Reaproveita o visual do comprovante de venda (`server/recibo.ts`).
 */

const AZUL = '#0F172A';
const CINZA = '#475569';
const BORDA = '#94A3B8';
const FAIXA = '#E2E8F0';
const CLARO = '#F8FAFC';

const dinheiro = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

export interface DadosComprovanteOS {
  modo: 'entrada' | 'servico';
  loja: DadosDaLoja;
  code: string;
  statusLabel: string;
  createdAt: Date;
  deliveredAt?: Date | null;
  customerName: string;
  customerPhone?: string | null;
  customerDocument?: string | null;
  technicianName?: string | null;
  unitName?: string | null;
  device: {
    brand?: string | null;
    model: string;
    color?: string | null;
    imei?: string | null;
    serial?: string | null;
    batteryHealth?: number | null;
  };
  accessories?: string | null;
  conditionIn?: string | null;
  checklist?: Record<string, unknown> | null;
  reportedProblem: string;
  diagnosis?: string | null;
  estimatedValue?: number | null;
  items: { kind: string; description: string; quantity: number; unitPrice: number }[];
  payments: { method: string; amount: number; installments: number }[];
  discount?: number | null;
  total: number;
  warrantyDays?: number | null;
  warrantyUntil?: Date | null;
  observacao?: string | null;
}

const CHECKLIST_LABEL: Record<string, string> = {
  liga: 'Liga',
  tela: 'Tela',
  touch: 'Touch',
  botoes: 'Botões',
  campainha: 'Alto-falante',
  microfone: 'Microfone',
  cameraFrontal: 'Câmera frontal',
  cameraTraseira: 'Câmera traseira',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  chip: 'Chip / sinal',
  carga: 'Carrega',
  biometria: 'Biometria',
  vibracao: 'Vibração',
  faceId: 'Face ID',
};

/** "Sim / Não / —" a partir do valor bruto do checklist. */
function estado(valor: unknown): string {
  if (valor === true || valor === 'sim' || valor === 'ok' || valor === 'true') return 'Sim';
  if (valor === false || valor === 'nao' || valor === 'não' || valor === 'false') return 'Não';
  if (valor === null || valor === undefined || valor === '') return '—';
  return String(valor);
}

export function comprovanteDeOS(res: Response, r: DadosComprovanteOS): void {
  const doc = new PDFDocument({ margin: 28, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="os-${r.code}.pdf"`);
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

  const paragrafo = (texto: string) => {
    const yl = doc.y;
    const t = texto.trim() || '—';
    const altura = Math.max(18, doc.heightOfString(t, { width: largura - PAD * 2 }) + 9);
    quadro(yl, altura);
    doc.fillColor('#1E293B').font('Helvetica').fontSize(8).text(t, x0 + PAD, yl + 5, {
      width: largura - PAD * 2,
    });
    doc.y = yl + altura;
  };

  const campos = (pares: [string, string][]) => {
    for (let i = 0; i < pares.length; i += 2) {
      const linha = pares.slice(i, i + 2);
      const yl = doc.y;
      quadro(yl, 16);
      const metade = largura / 2;
      linha.forEach(([rotulo, valor], col) => {
        const cx = x0 + col * metade;
        if (col === 1) {
          doc.moveTo(cx, yl).lineTo(cx, yl + 16).lineWidth(0.7).strokeColor(BORDA).stroke();
        }
        doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8).text(rotulo, cx + PAD, yl + 4.5, {
          width: 88,
          lineBreak: false,
        });
        doc.fillColor(AZUL).font('Helvetica').text(valor || '—', cx + PAD + 90, yl + 4.5, {
          width: metade - 90 - PAD * 2,
          lineBreak: false,
          ellipsis: true,
        });
      });
      doc.y = yl + 16;
    }
  };

  // ------------------------------------------------------------- Cabeçalho
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
  doc.font('Helvetica').fillColor(CINZA).text(`Técnico: ${r.technicianName?.trim() || '—'}`, x0, direitaY, {
    width: largura - PAD,
    align: 'right',
    lineBreak: false,
  });
  doc.y = y + alturaTopo;

  // --------------------------------------------------------------- Título
  y = doc.y;
  quadro(y, 20, CLARO);
  const titulo = r.modo === 'servico' ? `COMPROVANTE DE SERVIÇO · ${r.code}` : `ORDEM DE SERVIÇO · ${r.code}`;
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(11).text(titulo, x0, y + 5.5, {
    width: largura,
    align: 'center',
    lineBreak: false,
  });
  doc.fontSize(9).text(r.statusLabel, x0 + PAD, y + 6.5, {
    width: largura - PAD * 2,
    align: 'right',
    lineBreak: false,
  });
  doc.y = y + 20;

  // -------------------------------------------------------------- Cliente
  secao('CLIENTE');
  campos([
    ['Nome:', r.customerName || 'Não identificado'],
    ['Telefone:', r.customerPhone ?? ''],
    ['CPF/CNPJ:', r.customerDocument ?? ''],
    ['Loja:', r.unitName ?? ''],
    ['Entrada:', dataBR(r.createdAt)],
    [r.modo === 'servico' ? 'Entregue em:' : 'Previsão:', r.modo === 'servico' ? dataBR(r.deliveredAt) : '—'],
  ]);

  doc.y += 6;

  // ------------------------------------------------------------- Aparelho
  secao('APARELHO');
  campos([
    ['Modelo:', [r.device.brand, r.device.model, r.device.color].filter(Boolean).join(' ')],
    ['IMEI:', r.device.imei ?? ''],
    ['Nº de série:', r.device.serial ?? ''],
    ['Bateria:', r.device.batteryHealth != null ? `${r.device.batteryHealth}%` : ''],
  ]);
  if (r.accessories?.trim()) campos([['Acessórios:', r.accessories.trim()], ['', '']]);
  if (r.conditionIn?.trim()) {
    doc.y += 2;
    secao('ESTADO NA ENTRADA');
    paragrafo(r.conditionIn);
  }

  // ------------------------------------------------------------ Checklist
  const linhasChecklist = Object.entries(r.checklist ?? {}).filter(([, v]) => v !== undefined);
  if (linhasChecklist.length) {
    doc.y += 4;
    secao('CHECKLIST DE ENTRADA');
    const pares: [string, string][] = linhasChecklist.map(([k, v]) => [
      `${CHECKLIST_LABEL[k] ?? k}:`,
      estado(v),
    ]);
    campos(pares);
  }

  doc.y += 6;

  // --------------------------------------------------- Problema e laudo
  secao('PROBLEMA RELATADO');
  paragrafo(r.reportedProblem);
  if (r.diagnosis?.trim()) {
    doc.y += 2;
    secao('LAUDO TÉCNICO');
    paragrafo(r.diagnosis);
  }

  // ----------------------------------------------------- Itens / valores
  if (r.modo === 'servico' && r.items.length) {
    doc.y += 6;
    secao('SERVIÇOS E PEÇAS');

    const colunas = [
      { titulo: 'DESCRIÇÃO', peso: 56 },
      { titulo: 'TIPO', peso: 14 },
      { titulo: 'QTD', peso: 8, alinhar: 'right' as const },
      { titulo: 'VR. UNIT.', peso: 11, alinhar: 'right' as const },
      { titulo: 'SUBTOTAL', peso: 11, alinhar: 'right' as const },
    ];
    const peso = colunas.reduce((s, c) => s + c.peso, 0);
    const larguras = colunas.map((c) => (c.peso / peso) * largura);

    const linhaTabela = (valores: string[], opcoes?: { negrito?: boolean; fundo?: string }) => {
      const yl = doc.y;
      quadro(yl, 16, opcoes?.fundo);
      let x = x0;
      colunas.forEach((c, i) => {
        if (i > 0) doc.moveTo(x, yl).lineTo(x, yl + 16).lineWidth(0.7).strokeColor(BORDA).stroke();
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
      doc.y = yl + 16;
    };

    linhaTabela(colunas.map((c) => c.titulo), { negrito: true, fundo: FAIXA });
    for (const item of r.items) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 160) doc.addPage();
      linhaTabela([
        item.description,
        item.kind === 'PECA' ? 'Peça' : 'Serviço',
        String(item.quantity),
        dinheiro(item.unitPrice),
        dinheiro(item.unitPrice * item.quantity),
      ]);
    }

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

    const bruto = r.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    totalDireita('SUBTOTAL:', `R$ ${dinheiro(bruto)}`);
    if (r.discount && r.discount > 0) totalDireita('DESCONTO:', `- R$ ${dinheiro(r.discount)}`);
    totalDireita('TOTAL:', `R$ ${dinheiro(r.total)}`, true);

    doc.y += 4;
    secao('PAGAMENTO');
    for (const p of r.payments) {
      const forma = PAGAMENTO_LABEL[p.method] ?? p.method;
      const yl = doc.y;
      quadro(yl, 14);
      doc.fillColor('#1E293B').font('Helvetica').fontSize(8).text(
        p.installments > 1
          ? `${forma} — ${p.installments}x de R$ ${dinheiro(p.amount / p.installments)}`
          : forma,
        x0 + PAD,
        yl + 3.5,
        { width: largura * 0.6, lineBreak: false },
      );
      doc.font('Helvetica-Bold').fillColor(AZUL).text(`R$ ${dinheiro(p.amount)}`, x0, yl + 3.5, {
        width: largura - PAD,
        align: 'right',
        lineBreak: false,
      });
      doc.y = yl + 14;
    }
  } else if (r.modo === 'entrada') {
    doc.y += 6;
    secao('ORÇAMENTO');
    paragrafo(
      r.estimatedValue != null && r.estimatedValue > 0
        ? `Estimativa inicial: R$ ${dinheiro(r.estimatedValue)}. ` +
            'O valor final será confirmado com o cliente após a avaliação técnica. ' +
            'O aparelho só é consertado depois da aprovação do orçamento.'
        : 'O orçamento será informado ao cliente após a avaliação técnica. ' +
            'O aparelho só é consertado depois da aprovação.',
    );
  }

  // ------------------------------------------------------------- Garantia
  if (r.modo === 'servico') {
    doc.y += 6;
    secao('GARANTIA');
    paragrafo(
      r.warrantyDays && r.warrantyDays > 0
        ? `Serviço com garantia de ${r.warrantyDays} dias` +
            (r.warrantyUntil ? `, até ${dataBR(r.warrantyUntil)}.` : '.') +
            ' A garantia cobre o defeito consertado e a peça trocada. Não cobre ' +
            'mau uso, queda, contato com líquido, violação do lacre ou conserto por terceiros.'
        : 'Sem garantia adicional de serviço para este atendimento.',
    );
  }

  if (r.observacao?.trim()) {
    doc.y += 4;
    secao('OBSERVAÇÕES');
    paragrafo(r.observacao);
  }

  // ----------------------------------------------------------- Assinatura
  doc.y += 14;
  const yAss = doc.y;
  quadro(yAss, 44);
  doc
    .moveTo(x0 + largura * 0.25, yAss + 26)
    .lineTo(x0 + largura * 0.75, yAss + 26)
    .lineWidth(0.7)
    .strokeColor(AZUL)
    .stroke();
  doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(
    r.modo === 'servico' ? 'Assinatura do cliente — recebi o aparelho consertado' : 'Assinatura do cliente — deixei o aparelho para avaliação',
    x0,
    yAss + 30,
    { width: largura, align: 'center', lineBreak: false },
  );
  doc.y = yAss + 44;

  doc.y += 8;
  doc.fillColor(CINZA).fontSize(7).font('Helvetica').text(
    [
      r.loja.rodape,
      'Documento sem valor fiscal, emitido para controle interno. Guarde este comprovante ' +
        'para a retirada do aparelho e para qualquer atendimento de garantia.',
    ]
      .filter(Boolean)
      .join('\n'),
    x0,
    doc.y,
    { width: largura, align: 'center' },
  );

  doc.end();
}
