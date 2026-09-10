import type { MovementReason, MovementType, PaymentMethod, ProductStatus, UserRole } from '@/types';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat('pt-BR');

export const formatCurrency = (value: number | null | undefined) => currency.format(Number(value ?? 0));

export const formatCompactCurrency = (value: number | null | undefined) => {
  const number = Number(value ?? 0);
  return number >= 100_000 ? `R$ ${compact.format(number)}` : currency.format(number);
};

export const formatNumber = (value: number | null | undefined) => decimal.format(Number(value ?? 0));

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return formatDate(date);
}

/** Data no formato aceito por <input type="date"> */
export function toInputDate(value?: string | Date | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function formatPhone(value?: string | null): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

export const STATUS_LABEL: Record<ProductStatus, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  VENDIDO: 'Vendido',
};

export const DEVICE_STATUS_LABEL: Record<string, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EM_TRANSITO: 'Em trânsito',
  VENDIDO: 'Vendido',
  DEFEITO: 'Com defeito',
  DEVOLVIDO: 'Devolvido',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferência',
  TROCA: 'Troca (aparelho)',
  EM_ABERTO: 'Valor em aberto',
  OUTRO: 'Outro',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  TRANSFERENCIA: 'Transferência',
  AJUSTE: 'Ajuste',
};

export const REASON_LABEL: Record<MovementReason, string> = {
  COMPRA: 'Compra',
  CADASTRO: 'Cadastro de produto',
  VENDA: 'Venda',
  DEFEITO: 'Produto com defeito',
  DEVOLUCAO_FORNECEDOR: 'Devolução ao fornecedor',
  PERDA: 'Perda',
  USO_INTERNO: 'Uso interno',
  AJUSTE: 'Ajuste de estoque',
  TRANSFERENCIA: 'Transferência',
  RETIRADA: 'Retirada para a loja',
  CANCELAMENTO: 'Cancelamento',
  EXCLUSAO: 'Exclusão',
  OUTRO: 'Outro',
  REPARO: 'Reparo (Ordem de Serviço)',
};

export const OS_STATUS_LABEL: Record<string, string> = {
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

export const OS_STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent'> = {
  RECEBIDO: 'neutral',
  EM_ANALISE: 'info',
  ORCAMENTO: 'warning',
  APROVADO: 'accent',
  EM_REPARO: 'info',
  AGUARDANDO_PECA: 'warning',
  PRONTO: 'success',
  ENTREGUE: 'success',
  RECUSADO: 'danger',
  CANCELADO: 'danger',
};

export const EXIT_REASONS: MovementReason[] = [
  'VENDA',
  'DEFEITO',
  'DEVOLUCAO_FORNECEDOR',
  'PERDA',
  'USO_INTERNO',
  'AJUSTE',
  'OUTRO',
];

export const EXIT_REASON_OPTIONS = EXIT_REASONS.map((value) => ({
  value,
  label: REASON_LABEL[value],
}));

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  CAIXA: 'Caixa',
  VENDEDOR: 'Vendedor',
};

export const PRE_SALE_LABEL: Record<string, string> = {
  AGUARDANDO_CAIXA: 'Aguardando caixa',
  EM_ATENDIMENTO: 'Em atendimento',
  FINALIZADA: 'Venda finalizada',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Expirada',
};

export const PAYMENT_OPTIONS = (Object.keys(PAYMENT_LABEL) as PaymentMethod[])
  .filter((value) => value !== 'TROCA')
  .map((value) => ({ value, label: PAYMENT_LABEL[value] }));

export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ProductStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

/** Margem de lucro percentual entre custo e venda. */
export function profitMargin(cost: number, sale: number): number {
  if (!sale) return 0;
  return ((sale - cost) / sale) * 100;
}
