export type ProductStatus = 'EM_ESTOQUE' | 'RESERVADO' | 'VENDIDO';
export type MovementType = 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA' | 'AJUSTE';
export type TipoControle = 'UNITARIO' | 'QUANTIDADE';
export type DeviceStatus =
  | 'EM_ESTOQUE'
  | 'RESERVADO'
  | 'EM_TRANSITO'
  | 'VENDIDO'
  | 'DEFEITO'
  | 'DEVOLVIDO';

export type MovementReason =
  | 'COMPRA'
  | 'CADASTRO'
  | 'VENDA'
  | 'DEFEITO'
  | 'DEVOLUCAO_FORNECEDOR'
  | 'PERDA'
  | 'USO_INTERNO'
  | 'AJUSTE'
  | 'TRANSFERENCIA'
  | 'RETIRADA'
  | 'CANCELAMENTO'
  | 'EXCLUSAO'
  | 'OUTRO'
  | 'REPARO';

export type TransferStatus = 'PENDENTE' | 'EM_TRANSITO' | 'RECEBIDA' | 'CANCELADA';
export type WithdrawalStatus = 'PENDENTE' | 'APROVADA' | 'CANCELADA';

export interface Withdrawal {
  id: string;
  quantity: number;
  soldQuantity?: number | null;
  returnedQuantity?: number | null;
  status: WithdrawalStatus;
  notes?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  product: { id: string; name: string; model?: string | null };
  unit: { id: string; name: string };
}

export interface Unit {
  id: string;
  name: string;
  type: 'MATRIZ' | 'FILIAL';
  active: boolean;
  _count?: { stock: number; sales: number };
}

export interface StockLine {
  unitId: string;
  unitName: string;
  quantity: number;
  reserved?: number;
  available?: number;
}

export type PaymentMethod =
  | 'PIX'
  | 'DINHEIRO'
  | 'DEBITO'
  | 'CREDITO'
  | 'TRANSFERENCIA'
  | 'TROCA'
  | 'EM_ABERTO'
  | 'OUTRO';

export type UserRole = 'ADMIN' | 'GERENTE' | 'CAIXA' | 'VENDEDOR';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active?: boolean;
  unitId?: string | null;
  unit?: { id: string; name: string } | null;
  createdAt?: string;
  foto?: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  campos?: CampoDaCategoria[];
  color?: string | null;
  tipoControlePadrao?: TipoControle;
  _count?: { products: number };
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  ordem?: number;
  caminho?: string;
  ehSubcategoria?: boolean;
}

export interface CampoDaCategoria {
  campo: string;
  rotulo?: string;
  obrigatorio?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  address?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt?: string;
  _count?: { products: number };
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  notes?: string | null;
  createdAt?: string;
  _count?: { sales: number };
  sales?: Sale[];
}

/** Um aparelho físico de um produto UNITARIO. */
export interface DeviceUnit {
  id: string;
  productId: string;
  product?: { id: string; name: string; model?: string | null; brand?: string | null; tipoControle?: TipoControle; salePrice?: number };
  unitId?: string | null;
  unit?: { id: string; name: string } | null;
  imei?: string | null;
  imei2?: string | null;
  serialNumber?: string | null;
  status: DeviceStatus;
  condicao?: string | null;
  batteryHealth?: number | null;
  warrantyUntil?: string | null;
  costPrice: number;
  salePrice?: number | null;
  imeiSituacao: SituacaoImei;
  imeiCheckedAt?: string | null;
  notes?: string | null;
  entryDate: string;
  saleItemId?: string | null;
  saleItem?: { id: string; sale: { id: string; code: string; saleDate: string } } | null;
  createdAt: string;
  movements?: Movement[];
}

export interface Product {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  capacity?: string | null;
  ram?: string | null;
  lote?: string | null;
  condicao?: string | null;
  tipoControle: TipoControle;
  semEstoque?: boolean;
  garantiaPadraoDias?: number | null;
  quantity: number;
  minQuantity: number;
  costPrice: number;
  lastPurchaseCost?: number | null;
  lastPurchaseAt?: string | null;
  salePrice: number;
  wholesalePrice?: number | null;
  seminovo?: boolean;
  seminovoOrigem?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  barcode?: string | null;
  notes?: string | null;
  status: ProductStatus;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  categoryId: string;
  category: Category;
  supplierId?: string | null;
  supplier?: Supplier | null;
  photos: string[];
  stock: StockLine[];
  totalQuantity?: number;
  devicesEmEstoque?: number;
  devices?: DeviceUnit[];
  movements?: Movement[];
  saleItems?: SaleItemFull[];
}

export type PreSaleStatus =
  | 'AGUARDANDO_CAIXA'
  | 'EM_ATENDIMENTO'
  | 'FINALIZADA'
  | 'CANCELADA'
  | 'EXPIRADA';

export interface ItemVenda {
  id?: string;
  productId: string;
  productName?: string | null;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  imei?: string | null;
  serialNumber?: string | null;
  deviceId?: string | null;
  product?: {
    id: string;
    name: string;
    model?: string | null;
    brand?: string | null;
    capacity?: string | null;
    color?: string | null;
    condicao?: string | null;
    tipoControle?: TipoControle;
    photos?: { id: string }[];
  };
  disponivel?: number | null;
  foto?: string | null;
  detalhes?: string;
  minimo?: number | null;
}

export interface SaleItemFull extends ItemVenda {
  sale?: { code: string; saleDate: string; customerName?: string | null; unit?: { name: string } };
}

export interface PreSale {
  id: string;
  code: string;
  status: PreSaleStatus;
  totalAmount: number;
  paymentMethod?: PaymentMethod | null;
  installments: number;
  notes?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerDocument?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  items: ItemVenda[];
  seller?: { id: string; name: string } | null;
  cashier?: { id: string; name: string } | null;
  unit?: { id: string; name: string } | null;
  sale?: { id: string; code: string } | null;
  tradeIn?: Pick<
    Troca,
    'id' | 'code' | 'modelo' | 'imei' | 'imeiSituacao' | 'valorAvaliado' | 'estado' | 'defeitos'
  > | null;
}

export type SituacaoImei = 'NAO_CONSULTADO' | 'REGULAR' | 'IRREGULAR' | 'BLOQUEADO';
export type TrocaStatus = 'AVALIADA' | 'ACEITA' | 'RECUSADA';

export interface TrocaFoto {
  id: string;
  tipo: 'ANATEL' | 'DOCUMENTO' | 'APARELHO';
  url: string;
}

export interface TrocaAparelho {
  id: string;
  ordem: number;
  modelo: string;
  marca?: string | null;
  armazenamento?: string | null;
  cor?: string | null;
  imei?: string | null;
  imeiSituacao: SituacaoImei;
  estado?: string | null;
  defeitos: string[];
  observacoes?: string | null;
  valorAvaliado: number;
  fotos: TrocaFoto[];
}

export interface Troca {
  id: string;
  code: string;
  status: TrocaStatus;
  aparelhos: TrocaAparelho[];
  modelo: string;
  marca?: string | null;
  armazenamento?: string | null;
  cor?: string | null;
  imei: string;
  imeiSituacao: SituacaoImei;
  imeiCheckedAt?: string | null;
  estado?: string | null;
  defeitos: string[];
  observacoes?: string | null;
  valorAvaliado: number;
  saidaNome?: string | null;
  valorSaida: number;
  diferenca: number;
  customerName: string;
  customerPhone?: string | null;
  customerDocument?: string | null;
  createdAt: string;
  photos: TrocaFoto[];
  seller?: { id: string; name: string } | null;
  unit?: { id: string; name: string } | null;
  product?: { id: string; name: string } | null;
  preSale?: { id: string; code: string; status: PreSaleStatus } | null;
  sale?: { id: string; code: string } | null;
}

export interface Notificacao {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
}

export interface TurnoDeCaixa {
  id: string;
  code: string;
  status: 'ABERTO' | 'FECHADO';
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  cashier?: { name: string };
  unit?: { id?: string; name: string } | null;
}

export interface ResumoDoCaixa {
  quantidadeDeVendas: number;
  itensVendidos: number;
  total: number;
  lucro: number;
  ticketMedio: number;
  divergencia: number;
  porPagamento: { forma: PaymentMethod; rotulo: string; quantidade: number; total: number }[];
}

export interface Sale {
  id: string;
  code: string;
  status: 'FINALIZADA' | 'CANCELADA';
  totalAmount: number;
  costAmount: number;
  paymentMethod: PaymentMethod;
  installments: number;
  saleDate: string;
  notes?: string | null;
  items: ItemVenda[];
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerDocument?: string | null;
  unit: { id: string; name: string };
  seller?: { id: string; name: string } | null;
  cashier?: { id: string; name: string } | null;
  preSale?: { id: string; code: string } | null;
  sellerName?: string | null;
  payments?: {
    id: string;
    method: PaymentMethod;
    amount: number;
    installments: number;
    notes?: string | null;
  }[];
}

export interface Movement {
  id: string;
  type: MovementType;
  reason: MovementReason;
  quantity: number;
  previousQuantity?: number | null;
  newQuantity?: number | null;
  notes?: string | null;
  createdAt: string;
  productId?: string | null;
  productName?: string | null;
  product?: { id: string; name: string; model?: string | null; category?: { name: string } } | null;
  unitId?: string | null;
  unit?: { id: string; name: string } | null;
  originUnitName?: string | null;
  destinationUnitName?: string | null;
  transferId?: string | null;
  user?: { id: string; name: string } | null;
}

export interface Transfer {
  id: string;
  quantity: number;
  status: TransferStatus;
  notes?: string | null;
  createdAt: string;
  receivedAt?: string | null;
  product: { id: string; name: string; model?: string | null };
  originUnit: { id: string; name: string };
  destinationUnit: { id: string; name: string };
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
  ip?: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface SalesPage extends Paginated<Sale> {
  totals: { revenue: number; profit: number; items: number };
}

export interface PreSalesPage extends Paginated<PreSale> {
  pendentes: number;
}

export interface MovementsPage extends Paginated<Movement> {
  summary: Record<string, { count: number; quantity: number }>;
}

export interface StockPageResult extends Paginated<Product> {
  condicoes?: { condicao: string | null; produtos: number }[];
}

export interface DevicesPage extends Paginated<DeviceUnit> {}

export interface DashboardData {
  date?: string;
  cards: {
    totalProducts: number;
    itemsInStock: number;
    soldToday: number;
    salesCountToday: number;
    revenueToday: number;
    profitToday: number;
    stockValueCost: number;
    stockValueSale: number;
    lowStockCount: number;
    outOfStockCount: number;
    entradas: number;
    saidas: number;
    revenueMonth: number;
    profitMonth: number;
    itemsSoldMonth: number;
    osAbertas?: number;
    osProntas?: number;
    osEntreguesMes?: number;
    osFaturamentoServicoMes?: number;
  };
  chart: { date: string; vendas: number; faturamento: number; entradas: number; saidas: number }[];
  categories: { categoryId: string; name: string; color: string; products: number; quantity: number }[];
  lowStockProducts: Product[];
  latestSales: Sale[];
}

export interface AlertsData {
  lowStock: {
    id: string;
    name: string;
    quantity: number;
    minQuantity: number;
    model?: string | null;
    unitName?: string | null;
  }[];
  outOfStock: { id: string; name: string; model?: string | null; unitName?: string | null }[];
  soldToday: {
    id: string;
    code?: string;
    customerName?: string | null;
    totalAmount?: number;
    saleDate: string;
    items?: { productName: string; quantity: number }[];
    unit?: { name: string };
  }[];
  soldTodayCount: number;
  revenueToday: number;
  stockValue: number;
  updatedAt: string;
}

export interface QuickSearchResult {
  products: Product[];
  sales: Sale[];
  customers: Customer[];
}

// ------------------------------------------------------- Ordem de Serviço

export type ServiceOrderStatus =
  | 'RECEBIDO'
  | 'EM_ANALISE'
  | 'ORCAMENTO'
  | 'APROVADO'
  | 'EM_REPARO'
  | 'AGUARDANDO_PECA'
  | 'PRONTO'
  | 'ENTREGUE'
  | 'RECUSADO'
  | 'CANCELADO';

export interface ServiceOrderItem {
  id: string;
  kind: 'PECA' | 'SERVICO';
  description: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  productId?: string | null;
  deviceUnitId?: string | null;
}

export interface ServiceOrderPhoto {
  id: string;
  tipo: 'ENTRADA' | 'SAIDA';
  url: string;
}

export interface ServiceOrder {
  id: string;
  code: string;
  status: ServiceOrderStatus;
  statusLabel: string;
  aberta: boolean;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerDocument?: string | null;
  deviceBrand?: string | null;
  deviceModel: string;
  deviceColor?: string | null;
  deviceImei?: string | null;
  deviceSerial?: string | null;
  devicePassword?: string | null;
  accessories?: string | null;
  conditionIn?: string | null;
  checklistIn?: Record<string, boolean | string | number | null> | null;
  batteryHealth?: number | null;
  reportedProblem: string;
  diagnosis?: string | null;
  internalNotes?: string | null;
  estimatedValue?: number | null;
  quotedValue?: number | null;
  discount: number;
  totalAmount: number;
  costAmount: number;
  warrantyDays?: number | null;
  warrantyUntil?: string | null;
  technicianId?: string | null;
  technician?: { id: string; name: string } | null;
  unitId: string;
  unit?: { id: string; name: string } | null;
  saleId?: string | null;
  sale?: { id: string; code: string; totalAmount: number } | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  items: ServiceOrderItem[];
  photos: ServiceOrderPhoto[];
}

export interface ServiceOrdersPage extends Paginated<ServiceOrder> {
  contadores: Record<string, number>;
}

export interface MetasResult {
  rotulo: string;
  umDia: boolean;
  meta: number;
  vendedores: {
    chave: string;
    nome: string;
    grafias: string[];
    aparelhos: number;
    vendas: number;
    faturamento: number;
    lucro: number;
    dias: { data: string; aparelhos: number; faturamento: number; bateu: boolean }[];
    diasComVenda: number;
    diasBatidos: number;
    meta: number;
    atingiu: boolean;
    faltam: number;
    progresso: number;
  }[];
  resumo: { vendedores: number; bateram: number; aparelhos: number; faturamento: number };
  parecidos: string[][];
}
