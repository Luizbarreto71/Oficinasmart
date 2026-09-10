import { api } from '@/lib/api';
import type {
  AlertsData,
  AuditLog,
  Category,
  Customer,
  DashboardData,
  DeviceUnit,
  DevicesPage,
  MetasResult,
  MovementsPage,
  Notificacao,
  Paginated,
  PreSale,
  PreSalesPage,
  Product,
  QuickSearchResult,
  ResumoDoCaixa,
  Sale,
  SalesPage,
  ServiceOrder,
  ServiceOrdersPage,
  StockPageResult,
  Supplier,
  Transfer,
  Troca,
  TurnoDeCaixa,
  Unit,
  User,
  Withdrawal,
} from '@/types';

/** Camada de acesso à API. Os hooks do React Query consomem estas funções. */

const clean = (params: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null),
  );

// ------------------------------------------------------------------ Produtos

export interface ProductFilters {
  unitId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  categoryId?: string;
  supplierId?: string;
  status?: string;
  tipoControle?: string;
  brand?: string;
  model?: string;
  condicao?: string;
  lowStock?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const productService = {
  list: (filters: ProductFilters) =>
    api.get<StockPageResult>('/products', { params: clean(filters) }).then((r) => r.data),
  get: (id: string) => api.get<Product>(`/products/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Product>('/products', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<Product>(`/products/${id}`, data).then((r) => r.data),
  adjustStock: (id: string, data: { quantity: number; reason: string; unitId?: string }) =>
    api.patch<Product>(`/products/${id}/stock`, data).then((r) => r.data),
  remove: (id: string, reason?: string) =>
    api
      .delete<{ message: string; archived: boolean }>(`/products/${id}`, { params: clean({ reason }) })
      .then((r) => r.data),
  filters: () => api.get<{ brands: string[]; models: string[] }>('/products/filters').then((r) => r.data),
  quickSearch: (q: string) =>
    api.get<QuickSearchResult>('/products/search', { params: { q } }).then((r) => r.data),
};

// ------------------------------------------------------------------ Aparelhos

export const deviceService = {
  list: (params: { productId?: string; unitId?: string; status?: string; search?: string; page?: number } = {}) =>
    api.get<DevicesPage>('/devices', { params: clean(params) }).then((r) => r.data),
  get: (id: string) => api.get<DeviceUnit>(`/devices/${id}`).then((r) => r.data),
  porImei: (imei: string) =>
    api
      .get<{ encontrado: boolean; device?: DeviceUnit; resumo?: string; imeiValido?: boolean | null }>(
        `/devices/por-imei/${encodeURIComponent(imei)}`,
      )
      .then((r) => r.data),
  entrada: (data: Record<string, unknown>) =>
    api.post<{ criados: number; medio: number; message: string }>('/devices/entrada', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<DeviceUnit>(`/devices/${id}`, data).then((r) => r.data),
  baixa: (id: string, data: { motivo: string; notes?: string }) =>
    api.post<{ message: string }>(`/devices/${id}/baixa`, data).then((r) => r.data),
  retornar: (id: string) => api.post<{ message: string }>(`/devices/${id}/retornar`).then((r) => r.data),
  remove: (id: string) => api.delete<{ message: string }>(`/devices/${id}`).then((r) => r.data),
};

// -------------------------------------------------------------------- Vendas

export interface SaleFilters {
  unitId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  productId?: string;
  categoryId?: string;
  paymentMethod?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const saleService = {
  list: (filters: SaleFilters) => api.get<SalesPage>('/sales', { params: clean(filters) }).then((r) => r.data),
  get: (id: string) => api.get<Sale>(`/sales/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Sale>('/sales', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<Sale>(`/sales/${id}`, data).then((r) => r.data),
  remove: (id: string, reason?: string) =>
    api.delete<{ message: string }>(`/sales/${id}`, { params: clean({ reason }) }).then((r) => r.data),
};

// ------------------------------------------------------------- Movimentações

export interface MovementFilters {
  unitId?: string;
  reason?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  productId?: string;
  userId?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  sortOrder?: 'asc' | 'desc';
}

export const movementService = {
  list: (filters: MovementFilters) =>
    api.get<MovementsPage>('/movements', { params: clean(filters) }).then((r) => r.data),
  entrada: (data: Record<string, unknown>) =>
    api.post<{ message: string; antes: number; depois: number }>('/movements/entrada', data).then((r) => r.data),
  saida: (data: Record<string, unknown>) =>
    api.post<{ message: string; antes: number; depois: number }>('/movements/saida', data).then((r) => r.data),
  transferir: (data: Record<string, unknown>) =>
    api.post<{ message: string }>('/movements/transferencia', data).then((r) => r.data),
  ajustar: (data: Record<string, unknown>) =>
    api.post<{ message: string }>('/movements/ajuste', data).then((r) => r.data),
  transferencias: (params: { page?: number; status?: string; unitId?: string } = {}) =>
    api.get<Paginated<Transfer>>('/movements/transferencias', { params: clean(params) }).then((r) => r.data),
  retirar: (data: Record<string, unknown>) =>
    api.post<{ message: string; withdrawal: Withdrawal }>('/movements/retirada', data).then((r) => r.data),
  retiradas: (params: { page?: number; status?: string; unitId?: string } = {}) =>
    api.get<Paginated<Withdrawal>>('/movements/retiradas', { params: clean(params) }).then((r) => r.data),
  aprovarRetirada: (id: string, soldQuantity: number) =>
    api.post<{ message: string }>(`/movements/retiradas/${id}/aprovar`, { soldQuantity }).then((r) => r.data),
  cancelarRetirada: (id: string) =>
    api.post<{ message: string }>(`/movements/retiradas/${id}/cancelar`).then((r) => r.data),
  cancelarTransferencia: (id: string) =>
    api.post<{ message: string }>(`/movements/transferencias/${id}/cancelar`).then((r) => r.data),
};

export const unitService = {
  list: () => api.get<Unit[]>('/units').then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Unit>('/units', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => api.put<Unit>(`/units/${id}`, data).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ message: string; deactivated: boolean }>(`/units/${id}`).then((r) => r.data),
};

// ----------------------------------------------------------------- Dashboard

export const dashboardService = {
  overview: (days = 14, unitId?: string, date?: string) =>
    api.get<DashboardData>('/dashboard', { params: clean({ days, unitId, date }) }).then((r) => r.data),
  alerts: (unitId?: string) =>
    api.get<AlertsData>('/dashboard/alerts', { params: clean({ unitId }) }).then((r) => r.data),
};

// ----------------------------------------------------------------- Cadastros

export const categoryService = {
  list: () => api.get<Category[]>('/categories').then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Category>('/categories', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<Category>(`/categories/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/categories/${id}`).then((r) => r.data),
};

export const supplierService = {
  list: (params: { page?: number; pageSize?: number; search?: string; all?: string } = {}) =>
    api.get<Paginated<Supplier>>('/suppliers', { params: clean(params) }).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Supplier>('/suppliers', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<Supplier>(`/suppliers/${id}`, data).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ message: string; deactivated: boolean }>(`/suppliers/${id}`).then((r) => r.data),
};

export const customerService = {
  list: (params: { page?: number; pageSize?: number; search?: string; all?: string } = {}) =>
    api.get<Paginated<Customer>>('/customers', { params: clean(params) }).then((r) => r.data),
  get: (id: string) => api.get<Customer>(`/customers/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<Customer>('/customers', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<Customer>(`/customers/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/customers/${id}`).then((r) => r.data),
};

export const userService = {
  list: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    api.get<Paginated<User>>('/users', { params: clean(params) }).then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post<User>('/users', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => api.put<User>(`/users/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
  logs: (params: { page?: number; pageSize?: number; userId?: string } = {}) =>
    api.get<Paginated<AuditLog>>('/users/logs/activity', { params: clean(params) }).then((r) => r.data),
};

// ---------------------------------------------------------------- Importação

export const importService = {
  products: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<{
      dryRun: boolean;
      processed: number;
      imported: number;
      errors: { row: number; message: string }[];
      message: string;
    }>('/settings/import/products', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    return data;
  },
};

// -------------------------------------------------------------- Trocas

export const trocaService = {
  listar: (params: { status?: string; search?: string; livres?: string; page?: number } = {}) =>
    api.get<Paginated<Troca>>('/trocas', { params: clean(params) }).then((r) => r.data),
  buscar: (id: string) => api.get<Troca>(`/trocas/${id}`).then((r) => r.data),
  criar: (data: Record<string, unknown>) =>
    api.post<Troca & { message: string }>('/trocas', data).then((r) => r.data),
  anatel: (id: string, data: { imeiSituacao: string; foto?: string | null }) =>
    api.post<Troca>(`/trocas/${id}/anatel`, data).then((r) => r.data),
  recusar: (id: string) => api.post<{ message: string }>(`/trocas/${id}/recusar`).then((r) => r.data),
  excluir: (id: string) => api.delete<{ message: string }>(`/trocas/${id}`).then((r) => r.data),
};

// -------------------------------------------------------- Ordem de Serviço

export interface OrdemFilters {
  status?: string;
  abertas?: string;
  search?: string;
  unitId?: string;
  technicianId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export const ordemService = {
  listar: (filtros: OrdemFilters = {}) =>
    api.get<ServiceOrdersPage>('/service-orders', { params: clean(filtros) }).then((r) => r.data),
  buscar: (id: string) => api.get<ServiceOrder>(`/service-orders/${id}`).then((r) => r.data),
  criar: (data: Record<string, unknown>) =>
    api.post<ServiceOrder & { message: string }>('/service-orders', data).then((r) => r.data),
  editar: (id: string, data: Record<string, unknown>) =>
    api.put<ServiceOrder & { message: string }>(`/service-orders/${id}`, data).then((r) => r.data),
  status: (id: string, status: string) =>
    api
      .post<ServiceOrder & { message: string }>(`/service-orders/${id}/status`, { status })
      .then((r) => r.data),
  orcar: (id: string, data: Record<string, unknown>) =>
    api
      .post<ServiceOrder & { message: string }>(`/service-orders/${id}/orcamento`, data)
      .then((r) => r.data),
  aprovar: (id: string) =>
    api.post<ServiceOrder & { message: string }>(`/service-orders/${id}/aprovar`).then((r) => r.data),
  recusar: (id: string, motivo?: string) =>
    api
      .post<ServiceOrder & { message: string }>(`/service-orders/${id}/recusar`, { motivo })
      .then((r) => r.data),
  entregar: (id: string, data: Record<string, unknown>) =>
    api
      .post<ServiceOrder & { sale?: { id: string; code: string; totalAmount: number }; message: string }>(
        `/service-orders/${id}/entregar`,
        data,
      )
      .then((r) => r.data),
  cancelar: (id: string, reason?: string) =>
    api
      .delete<{ message: string }>(`/service-orders/${id}`, { params: clean({ reason }) })
      .then((r) => r.data),
  comprovanteUrl: (id: string) => `/service-orders/${id}/comprovante`,
};

export const preVendaService = {
  listar: (params: { status?: string; sellerId?: string; search?: string; page?: number } = {}) =>
    api.get<PreSalesPage>('/pre-sales', { params: clean(params) }).then((r) => r.data),
  buscar: (id: string) => api.get<PreSale>(`/pre-sales/${id}`).then((r) => r.data),
  criar: (data: Record<string, unknown>) =>
    api.post<PreSale & { message: string }>('/pre-sales', data).then((r) => r.data),
  atender: (id: string) => api.post<PreSale>(`/pre-sales/${id}/atender`).then((r) => r.data),
  finalizar: (id: string, data: Record<string, unknown>) =>
    api.post<{ sale: Sale; message: string }>(`/pre-sales/${id}/finalizar`, data).then((r) => r.data),
  cancelar: (id: string, motivo?: string) =>
    api.post<{ message: string }>(`/pre-sales/${id}/cancelar`, { motivo }).then((r) => r.data),
  desistir: (id: string) => api.delete<{ message: string }>(`/pre-sales/${id}`).then((r) => r.data),
};

// ------------------------------------------------------------------ Caixa

export const caixaService = {
  atual: () =>
    api
      .get<{ aberto: boolean; turno: TurnoDeCaixa | null; resumo: ResumoDoCaixa | null }>('/cash/atual')
      .then((r) => r.data),
  abrir: (data: { unitId?: string; notes?: string }) =>
    api.post<{ turno: TurnoDeCaixa; message: string }>('/cash/abrir', data).then((r) => r.data),
  fechar: (notes?: string) =>
    api
      .post<{ turno: TurnoDeCaixa; resumo: ResumoDoCaixa; message: string }>('/cash/fechar', { notes })
      .then((r) => r.data),
  turnos: (params: { status?: string; cashierId?: string } = {}) =>
    api.get<TurnoDeCaixa[]>('/cash', { params: clean(params) }).then((r) => r.data),
};

// -------------------------------------------------------------- Seminovos

export const seminovoService = {
  listar: (params: { search?: string; unitId?: string; origem?: string; disponivel?: string; page?: number } = {}) =>
    api
      .get<Paginated<Product> & { resumo: { pecas: number; investido: number } }>('/seminovos', {
        params: clean(params),
      })
      .then((r) => r.data),
  comprar: (data: Record<string, unknown>) =>
    api.post<Product & { message: string }>('/seminovos', data).then((r) => r.data),
};

// ------------------------------------------------------------------ Metas

export const metaService = {
  placar: (params: { inicio?: string; fim?: string; unitId?: string } = {}) =>
    api.get<MetasResult>('/metas', { params: clean(params) }).then((r) => r.data),
  nomes: () => api.get<{ nomes: string[] }>('/metas/lista/nomes').then((r) => r.data),
};

// --------------------------------------------------------------- Em aberto

export const emAbertoService = {
  listar: (params: { search?: string; situacao?: string; unitId?: string; page?: number } = {}) =>
    api
      .get<Paginated<Record<string, unknown>> & { resumo: { cobrancas: number; total: number } }>('/em-aberto', {
        params: clean(params),
      })
      .then((r) => r.data),
  receber: (id: string, method: string) =>
    api.post<{ message: string }>(`/em-aberto/${id}/receber`, { method }).then((r) => r.data),
  reabrir: (id: string) => api.post<{ message: string }>(`/em-aberto/${id}/reabrir`).then((r) => r.data),
};

// ------------------------------------------------------------ Notificações

export const notificacaoService = {
  listar: (naoLidas = false) =>
    api
      .get<Paginated<Notificacao> & { unread: number }>('/notifications', {
        params: clean({ naoLidas: naoLidas ? 'true' : undefined }),
      })
      .then((r) => r.data),
  marcarLida: (id?: string) => api.post('/notifications/ler', id ? { id } : {}).then((r) => r.data),
};

// -------------------------------------------------------------- Configurações

export const settingsService = {
  sheetsStatus: () =>
    api
      .get<{ enabled: boolean; configured: boolean; spreadsheetId: string | null; sheetName: string }>(
        '/settings/sheets/status',
      )
      .then((r) => r.data),
  syncSheets: () => api.post<{ message: string; synced: number }>('/settings/sheets/sync').then((r) => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ message: string }>('/auth/change-password', data).then((r) => r.data),
  loja: () => api.get<Record<string, string>>('/settings/loja').then((r) => r.data),
  salvarLoja: (data: Record<string, unknown>) =>
    api.put<{ message: string }>('/settings/loja', data).then((r) => r.data),
  taxas: () =>
    api
      .get<{ taxas: { parcelas: number; padrao: number; elo?: number | null }[]; padrao: unknown }>(
        '/settings/taxas-cartao',
      )
      .then((r) => r.data),
  salvarTaxas: (taxas: unknown[]) =>
    api.put<{ message: string }>('/settings/taxas-cartao', { taxas }).then((r) => r.data),
  unidadeDeVenda: () =>
    api.get<{ unitId: string | null; name: string | null }>('/settings/unidade-de-venda').then((r) => r.data),
  salvarUnidadeDeVenda: (unitId: string) =>
    api.put<{ message: string }>('/settings/unidade-de-venda', { unitId }).then((r) => r.data),
  chaveDeAcesso: () => api.get<{ definida: boolean }>('/settings/chave-de-acesso').then((r) => r.data),
  salvarChave: (chave: string) =>
    api.put<{ message: string }>('/settings/chave-de-acesso', { chave }).then((r) => r.data),
  removerChave: () => api.delete<{ message: string }>('/settings/chave-de-acesso').then((r) => r.data),
  meta: () => api.get<{ meta: number }>('/settings/meta-de-vendas').then((r) => r.data),
  salvarMeta: (meta: number) =>
    api.put<{ message: string }>('/settings/meta-de-vendas', { meta }).then((r) => r.data),
};
