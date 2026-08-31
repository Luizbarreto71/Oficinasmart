import axios from 'axios';
import { api, STORAGE_KEYS } from './api';

/**
 * Fila de operações offline.
 *
 * Quando o navegador está sem internet, as gravações são guardadas no
 * localStorage e reenviadas automaticamente assim que a conexão volta.
 */

export interface QueuedRequest {
  id: string;
  method: 'post' | 'put' | 'patch' | 'delete';
  url: string;
  data?: unknown;
  label: string;
  createdAt: string;
  attempts: number;
}

type Listener = (queue: QueuedRequest[]) => void;

const listeners = new Set<Listener>();

function read(): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.offlineQueue);
    return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

function write(queue: QueuedRequest[]): void {
  localStorage.setItem(STORAGE_KEYS.offlineQueue, JSON.stringify(queue));
  listeners.forEach((listener) => listener(queue));
}

export function getQueue(): QueuedRequest[] {
  return read();
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(read());
  return () => listeners.delete(listener);
}

export function enqueue(request: Omit<QueuedRequest, 'id' | 'createdAt' | 'attempts'>): QueuedRequest {
  const item: QueuedRequest = {
    ...request,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  write([...read(), item]);
  return item;
}

export function removeFromQueue(id: string): void {
  write(read().filter((item) => item.id !== id));
}

export function clearQueue(): void {
  write([]);
}

/** Identifica erros que valem uma nova tentativa (falta de rede). */
export function isOfflineError(error: unknown): boolean {
  if (!navigator.onLine) return true;
  return axios.isAxiosError(error) && (error.code === 'ERR_NETWORK' || error.response === undefined);
}

let flushing = false;

export interface FlushResult {
  sent: number;
  failed: number;
}

/** Reenvia a fila na ordem em que foi criada. */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing || !navigator.onLine) return { sent: 0, failed: 0 };

  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    for (const item of read()) {
      try {
        await api.request({ method: item.method, url: item.url, data: item.data });
        removeFromQueue(item.id);
        sent += 1;
      } catch (error) {
        if (isOfflineError(error)) break;
        removeFromQueue(item.id);
        failed += 1;
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, failed };
}

/** Dispara a sincronização sempre que a conexão voltar. */
export function startOfflineWatcher(onSync: (result: FlushResult) => void): () => void {
  const handler = () => {
    void flushQueue().then((result) => {
      if (result.sent || result.failed) onSync(result);
    });
  };

  window.addEventListener('online', handler);
  if (navigator.onLine) handler();

  return () => window.removeEventListener('online', handler);
}
