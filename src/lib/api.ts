import axios, { AxiosError, AxiosRequestConfig } from 'axios';

/**
 * A API roda no mesmo domínio do site (função serverless da Vercel em
 * `/api`), então o caminho é relativo. Em desenvolvimento o Vite monta a
 * API no mesmo processo.
 */
export const API_URL = '/api';

export const STORAGE_KEYS = {
  token: 'ofs:token',
  refreshToken: 'ofs:refreshToken',
  user: 'ofs:user',
  theme: 'ofs:theme',
  offlineQueue: 'ofs:offlineQueue',
  sidebar: 'ofs:sidebarCollapsed',
  unidade: 'ofs:unidade',
} as const;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Transforma qualquer erro numa frase que a pessoa consegue entender. */
export function getErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Ocorreu um erro inesperado';
  }

  const dados = error.response?.data as
    | {
        error?: string | { code?: string; message?: string };
        details?: { field: string; message: string }[];
      }
    | string
    | undefined;

  if (typeof dados === 'object' && dados?.details?.length) {
    return dados.details.map((d) => d.message).filter(Boolean).join(' · ');
  }

  if (typeof dados === 'object' && typeof dados?.error === 'string') return dados.error;

  if (typeof dados === 'object' && dados?.error && typeof dados.error === 'object') {
    const codigo = String(dados.error.code ?? '');
    if (codigo.includes('TIMEOUT')) {
      return 'O servidor demorou demais para responder. Tente novamente.';
    }
    return `O servidor falhou${codigo ? ` (${codigo})` : ''}. Veja os logs da Vercel.`;
  }

  if (error.code === 'ERR_NETWORK') return 'Sem conexão com o servidor. Verifique sua internet.';
  if (error.code === 'ECONNABORTED') return 'A requisição demorou demais. Tente novamente.';

  const status = error.response?.status;
  if (status === 404) return 'Endereço da API não encontrado (404).';
  if (status === 413) return 'Envio grande demais. Reduza as fotos e tente de novo.';
  if (status && status >= 500) return `Erro no servidor (${status}). Veja os logs da Vercel.`;
  if (status) return `A requisição falhou (${status}).`;

  return error.message || 'Ocorreu um erro inesperado';
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    localStorage.setItem(STORAGE_KEYS.token, data.token);
    localStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data.user));
    return data.token as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthRoute = original?.url?.includes('/auth/');

    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;

      refreshing = refreshing ?? refreshAccessToken();
      const token = await refreshing;
      refreshing = null;

      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return api(original);
      }

      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.refreshToken);
      localStorage.removeItem(STORAGE_KEYS.user);

      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

/** Baixa um arquivo gerado pela API (relatórios, backup, modelo de planilha). */
export async function downloadFile(
  url: string,
  params: Record<string, unknown> = {},
  fallbackName = 'arquivo',
): Promise<void> {
  const limpos = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );

  const response = await api.get(url, { params: limpos, responseType: 'blob' });

  const disposition = response.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? fallbackName;

  const href = URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/** Abre um PDF (recibo) numa nova aba. */
export async function openPdf(url: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
  window.open(href, '_blank');
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
