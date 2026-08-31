import { cn } from '@/lib/cn';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, options?: { description?: string; variant?: ToastVariant; duration?: number }) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastVariant, string> = {
  success: 'border-l-success bg-white dark:bg-navy-800',
  error: 'border-l-danger bg-white dark:bg-navy-800',
  warning: 'border-l-warning bg-white dark:bg-navy-800',
  info: 'border-l-accent bg-white dark:bg-navy-800',
};

const ICON_COLOR: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-accent',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>(
    (message, options) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: Toast = {
        id,
        message,
        description: options?.description,
        variant: options?.variant ?? 'info',
      };

      setToasts((current) => [...current.slice(-3), item]);
      window.setTimeout(() => dismiss(id), options?.duration ?? 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message, description) => toast(message, { description, variant: 'success' }),
      error: (message, description) => toast(message, { description, variant: 'error', duration: 6000 }),
      warning: (message, description) => toast(message, { description, variant: 'warning' }),
      info: (message, description) => toast(message, { description, variant: 'info' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-live="polite"
      >
        {toasts.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex animate-slide-in-right items-start gap-3 rounded-lg border border-slate-200 border-l-4 p-3.5 shadow-card-hover dark:border-navy-700',
                STYLES[item.variant],
              )}
              role="alert"
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', ICON_COLOR[item.variant])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900 dark:text-slate-100">{item.message}</p>
                {item.description && (
                  <p className="mt-0.5 break-words text-xs text-slate-600 dark:text-slate-400">
                    {item.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-navy-700"
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return context;
}
