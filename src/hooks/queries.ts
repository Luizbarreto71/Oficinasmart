import { getErrorMessage } from '@/lib/api';
import { enqueue, isOfflineError } from '@/lib/offline';
import {
  caixaService,
  categoryService,
  customerService,
  dashboardService,
  deviceService,
  emAbertoService,
  metaService,
  movementService,
  notificacaoService,
  ordemService,
  preVendaService,
  productService,
  saleService,
  seminovoService,
  settingsService,
  supplierService,
  trocaService,
  unitService,
  userService,
  type MovementFilters,
  type OrdemFilters,
  type ProductFilters,
  type SaleFilters,
} from '@/services';
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';

export const queryKeys = {
  dashboard: (days: number) => ['dashboard', days] as const,
  alerts: () => ['dashboard', 'alerts'] as const,
  products: (filters: ProductFilters) => ['products', filters] as const,
  product: (id: string) => ['products', id] as const,
  productFilters: () => ['products', 'filters'] as const,
  sales: (filters: SaleFilters) => ['sales', filters] as const,
  movements: (filters: MovementFilters) => ['movements', filters] as const,
  categories: () => ['categories'] as const,
  suppliers: (params: object) => ['suppliers', params] as const,
  customers: (params: object) => ['customers', params] as const,
  users: (params: object) => ['users', params] as const,
  logs: (params: object) => ['logs', params] as const,
  sheetsStatus: () => ['settings', 'sheets'] as const,
  devices: (params: object) => ['devices', params] as const,
};

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['devices'] });
  void qc.invalidateQueries({ queryKey: ['sales'] });
  void qc.invalidateQueries({ queryKey: ['movements'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['seminovos'] });
}

// ----------------------------------------------------------------- Dashboard

export const useDashboard = (days = 14, unitId?: string | null, date?: string) =>
  useQuery({
    queryKey: [...queryKeys.dashboard(days), unitId ?? 'todas', date ?? 'hoje'],
    queryFn: () => dashboardService.overview(days, unitId ?? undefined, date),
    staleTime: 30_000,
    refetchInterval: date ? false : 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

export const useAlerts = (enabled = true, unitId?: string | null) =>
  useQuery({
    queryKey: [...queryKeys.alerts(), unitId ?? 'todas'],
    queryFn: () => dashboardService.alerts(unitId ?? undefined),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled,
  });

// ------------------------------------------------------------------ Produtos

export const useProducts = (filters: ProductFilters) =>
  useQuery({
    queryKey: queryKeys.products(filters),
    queryFn: () => productService.list(filters),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

export const useProduct = (id?: string) =>
  useQuery({
    queryKey: queryKeys.product(id ?? ''),
    queryFn: () => productService.get(id!),
    enabled: Boolean(id),
  });

export const useProductFilters = () =>
  useQuery({
    queryKey: queryKeys.productFilters(),
    queryFn: productService.filters,
    staleTime: 5 * 60_000,
  });

export const useQuickSearch = (term: string) =>
  useQuery({
    queryKey: ['quick-search', term],
    queryFn: () => productService.quickSearch(term),
    enabled: term.trim().length >= 2,
    staleTime: 10_000,
  });

interface OfflineOptions {
  offlineLabel?: string;
}

export function useCreateProduct(options?: OfflineOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      try {
        return await productService.create(data);
      } catch (error) {
        if (isOfflineError(error)) {
          enqueue({
            method: 'post',
            url: '/products',
            data,
            label: options?.offlineLabel ?? `Cadastro: ${data.name}`,
          });
          throw new Error('OFFLINE_QUEUED');
        }
        throw new Error(getErrorMessage(error));
      }
    },
    onSuccess: () => invalidateStock(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      productService.update(id, data).catch((error) => {
        if (isOfflineError(error)) {
          enqueue({ method: 'put', url: `/products/${id}`, data, label: `Edição: ${data.name ?? id}` });
          throw new Error('OFFLINE_QUEUED');
        }
        throw new Error(getErrorMessage(error));
      }),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      productService.remove(id, reason).catch((error) => {
        throw new Error(getErrorMessage(error));
      }),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; quantity: number; reason: string; unitId?: string }) =>
      productService.adjustStock(v.id, { quantity: v.quantity, reason: v.reason, unitId: v.unitId }).catch((error) => {
        throw new Error(getErrorMessage(error));
      }),
    onSuccess: () => invalidateStock(qc),
  });
}

// ------------------------------------------------------------------ Aparelhos

export const useDevices = (params: { productId?: string; unitId?: string; status?: string; search?: string; page?: number } = {}) =>
  useQuery({
    queryKey: queryKeys.devices(params),
    queryFn: () => deviceService.list(params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

export function useDeviceAction(acao: 'entrada' | 'update' | 'baixa' | 'retornar' | 'remove') {
  const qc = useQueryClient();
  return useMutation<{ message?: string } & Record<string, unknown>, Error, { id?: string; data?: Record<string, unknown> }>({
    mutationFn: (v) => {
      const call =
        acao === 'entrada'
          ? deviceService.entrada(v.data ?? {})
          : acao === 'update'
            ? deviceService.update(v.id!, v.data ?? {})
            : acao === 'baixa'
              ? deviceService.baixa(v.id!, v.data as never)
              : acao === 'retornar'
                ? deviceService.retornar(v.id!)
                : deviceService.remove(v.id!);
      return call.catch((e) => {
        throw new Error(getErrorMessage(e));
      }) as Promise<{ message?: string } & Record<string, unknown>>;
    },
    onSuccess: () => invalidateStock(qc),
  });
}

// -------------------------------------------------------------------- Vendas

export const useSales = (filters: SaleFilters) =>
  useQuery({
    queryKey: queryKeys.sales(filters),
    queryFn: () => saleService.list(filters),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      try {
        return await saleService.create(data);
      } catch (error) {
        if (isOfflineError(error)) {
          enqueue({
            method: 'post',
            url: '/sales',
            data,
            label: `Venda: ${data.customerName || 'Consumidor'}`,
          });
          throw new Error('OFFLINE_QUEUED');
        }
        throw new Error(getErrorMessage(error));
      }
    },
    onSuccess: () => invalidateStock(qc),
  });
}

export function useDeleteSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason?: string }) =>
      saleService.remove(v.id, v.reason).catch((error) => {
        throw new Error(getErrorMessage(error));
      }),
    onSuccess: () => invalidateStock(qc),
  });
}

// ------------------------------------------------------------- Movimentações

export const useMovements = (filters: MovementFilters) =>
  useQuery({
    queryKey: queryKeys.movements(filters),
    queryFn: () => movementService.list(filters),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

export function useMovimentarEstoque(acao: 'entrada' | 'saida' | 'transferir' | 'ajustar') {
  const qc = useQueryClient();
  return useMutation<{ message: string } & Record<string, unknown>, Error, Record<string, unknown>>({
    mutationFn: (data) =>
      movementService[acao](data).catch((erro) => {
        throw new Error(getErrorMessage(erro));
      }),
    onSuccess: () => {
      invalidateStock(qc);
      void qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
}

// ----------------------------------------------------------------- Cadastros

export const useCategories = () =>
  useQuery({ queryKey: queryKeys.categories(), queryFn: categoryService.list, staleTime: 5 * 60_000 });

export const useSuppliers = (params: { page?: number; pageSize?: number; search?: string; all?: string } = {}) =>
  useQuery({
    queryKey: queryKeys.suppliers(params),
    queryFn: () => supplierService.list(params),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });

export const useCustomers = (params: { page?: number; pageSize?: number; search?: string; all?: string } = {}) =>
  useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => customerService.list(params),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });

export const useUsers = (params: { page?: number; pageSize?: number; search?: string } = {}, enabled = true) =>
  useQuery({ queryKey: queryKeys.users(params), queryFn: () => userService.list(params), enabled, staleTime: 60_000 });

export const useActivityLogs = (params: { page?: number; pageSize?: number } = {}, enabled = true) =>
  useQuery({ queryKey: queryKeys.logs(params), queryFn: () => userService.logs(params), enabled, staleTime: 30_000 });

export const useSheetsStatus = () =>
  useQuery({ queryKey: queryKeys.sheetsStatus(), queryFn: settingsService.sheetsStatus, staleTime: 5 * 60_000 });

/** Fábrica de mutações CRUD para os cadastros simples. */
export function useCrudMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKey: string,
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>,
) {
  const qc = useQueryClient();
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) =>
      mutationFn(variables).catch((error) => {
        throw new Error(getErrorMessage(error));
      }),
    ...options,
    onSuccess: (...args) => {
      void qc.invalidateQueries({ queryKey: [invalidateKey] });
      options?.onSuccess?.(...args);
    },
  });
}

// ------------------------------------------------------------------ Unidades

export const useUnits = () =>
  useQuery({ queryKey: ['units'], queryFn: unitService.list, staleTime: 5 * 60_000 });

export const useTransfers = (params: { page?: number; status?: string; unitId?: string } = {}) =>
  useQuery({
    queryKey: ['transfers', params],
    queryFn: () => movementService.transferencias(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

export const useWithdrawals = (params: { status?: string; unitId?: string } = {}) =>
  useQuery({
    queryKey: ['withdrawals', params],
    queryFn: () => movementService.retiradas(params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

export function useRetirada(acao: 'criar' | 'aprovar' | 'cancelar') {
  const qc = useQueryClient();
  return useMutation<{ message: string }, Error, { id?: string; soldQuantity?: number } & Record<string, unknown>>({
    mutationFn: (v) => {
      const chamada =
        acao === 'criar'
          ? movementService.retirar(v)
          : acao === 'aprovar'
            ? movementService.aprovarRetirada(v.id!, v.soldQuantity ?? 0)
            : movementService.cancelarRetirada(v.id!);
      return chamada.catch((erro) => {
        throw new Error(getErrorMessage(erro));
      });
    },
    onSuccess: () => {
      invalidateStock(qc);
      void qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

export function useCancelarTransferencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      movementService.cancelarTransferencia(id).catch((erro) => {
        throw new Error(getErrorMessage(erro));
      }),
    onSuccess: () => {
      invalidateStock(qc);
      void qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
}

// ------------------------------------------------------------- Pré-vendas

export const usePreVendas = (params: { status?: string; search?: string; page?: number } = {}) =>
  useQuery({
    queryKey: ['pre-sales', params],
    queryFn: () => preVendaService.listar(params),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

export const usePreVenda = (id?: string) =>
  useQuery({
    queryKey: ['pre-sales', id],
    queryFn: () => preVendaService.buscar(id!),
    enabled: Boolean(id),
  });

function useAcaoDePreVenda<T>(acao: (v: T) => Promise<{ message: string } | unknown>) {
  const qc = useQueryClient();
  return useMutation<{ message: string; sale?: import('@/types').Sale }, Error, T>({
    mutationFn: (v) =>
      acao(v).catch((erro) => {
        throw new Error(getErrorMessage(erro));
      }) as Promise<{ message: string; sale?: import('@/types').Sale }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pre-sales'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      invalidateStock(qc);
    },
  });
}

export const useCriarPreVenda = () =>
  useAcaoDePreVenda((dados: Record<string, unknown>) => preVendaService.criar(dados));
export const useAtenderPreVenda = () => useAcaoDePreVenda((id: string) => preVendaService.atender(id));
export const useFinalizarPreVenda = () =>
  useAcaoDePreVenda((v: { id: string; dados: Record<string, unknown> }) =>
    preVendaService.finalizar(v.id, v.dados),
  );
export const useCancelarPreVenda = () =>
  useAcaoDePreVenda((v: { id: string; motivo?: string }) => preVendaService.cancelar(v.id, v.motivo));
export const useDesistirPreVenda = () => useAcaoDePreVenda((id: string) => preVendaService.desistir(id));

// ------------------------------------------------------------------ Caixa

export const useCaixaAtual = (habilitado = true) =>
  useQuery({
    queryKey: ['cash', 'atual'],
    queryFn: caixaService.atual,
    enabled: habilitado,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

export const useTurnosDeCaixa = (params: { status?: string } = {}, habilitado = true) =>
  useQuery({
    queryKey: ['cash', params],
    queryFn: () => caixaService.turnos(params),
    enabled: habilitado,
    staleTime: 30_000,
  });

export function useAcaoDeCaixa<T>(acao: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation<{ message: string } & Record<string, unknown>, Error, T>({
    mutationFn: (v) =>
      acao(v).catch((erro) => {
        throw new Error(getErrorMessage(erro));
      }) as Promise<{ message: string } & Record<string, unknown>>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash'] });
      invalidateStock(qc);
    },
  });
}

// ------------------------------------------------------------ Notificações

export const useNotificacoes = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificacaoService.listar(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

export function useMarcarLida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => notificacaoService.marcarLida(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ------------------------------------------------------------------ Trocas

export const useTrocas = (params: { status?: string; search?: string; livres?: string } = {}) =>
  useQuery({ queryKey: ['trocas', params], queryFn: () => trocaService.listar(params), staleTime: 15_000 });

export function useTroca(acao: 'criar' | 'anatel' | 'recusar' | 'excluir') {
  const qc = useQueryClient();
  return useMutation<{ message?: string } & Record<string, unknown>, Error, { id?: string; dados?: Record<string, unknown> }>({
    mutationFn: (v) =>
      (acao === 'criar'
        ? trocaService.criar(v.dados ?? {})
        : acao === 'anatel'
          ? trocaService.anatel(v.id!, v.dados as never)
          : acao === 'recusar'
            ? trocaService.recusar(v.id!)
            : trocaService.excluir(v.id!)
      ).catch((e) => {
        throw new Error(getErrorMessage(e));
      }) as Promise<{ message?: string } & Record<string, unknown>>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trocas'] });
      void qc.invalidateQueries({ queryKey: ['pre-sales'] });
    },
  });
}

// ------------------------------------------------------- Ordem de Serviço

export const useOrdens = (filtros: OrdemFilters = {}) =>
  useQuery({
    queryKey: ['service-orders', 'lista', filtros],
    queryFn: () => ordemService.listar(filtros),
    placeholderData: (previous) => previous,
    refetchInterval: 45_000,
    staleTime: 15_000,
  });

export const useOrdem = (id?: string) =>
  useQuery({
    queryKey: ['service-orders', 'item', id],
    queryFn: () => ordemService.buscar(id!),
    enabled: Boolean(id),
  });

export function useAcaoDeOrdem<T>(acao: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation<{ message: string } & Record<string, unknown>, Error, T>({
    mutationFn: (v) =>
      acao(v).catch((e) => {
        throw new Error(getErrorMessage(e));
      }) as Promise<{ message: string } & Record<string, unknown>>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['service-orders'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      invalidateStock(qc);
    },
  });
}

// ---------------------------------------------------------------- Seminovos

export const useSeminovos = (params: { search?: string; unitId?: string; origem?: string; disponivel?: string } = {}) =>
  useQuery({
    queryKey: ['seminovos', params],
    queryFn: () => seminovoService.listar(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

// ------------------------------------------------------------------- Metas

export const useMetas = (params: { inicio?: string; fim?: string; unitId?: string } = {}) =>
  useQuery({ queryKey: ['metas', params], queryFn: () => metaService.placar(params), staleTime: 30_000 });

// --------------------------------------------------------------- Em aberto

export const useEmAberto = (params: { search?: string; situacao?: string; unitId?: string } = {}) =>
  useQuery({
    queryKey: ['em-aberto', params],
    queryFn: () => emAbertoService.listar(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

export function useEmAbertoAction(acao: 'receber' | 'reabrir') {
  const qc = useQueryClient();
  return useMutation<{ message: string }, Error, { id: string; method?: string }>({
    mutationFn: (v) =>
      (acao === 'receber' ? emAbertoService.receber(v.id, v.method ?? 'DINHEIRO') : emAbertoService.reabrir(v.id)).catch(
        (e) => {
          throw new Error(getErrorMessage(e));
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['em-aberto'] }),
  });
}
