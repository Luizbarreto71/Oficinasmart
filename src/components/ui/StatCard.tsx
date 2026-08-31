import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'accent';
}

const TONES = {
  neutral: 'text-navy-900 dark:text-slate-100',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent',
};

const ICON_BG = {
  neutral: 'bg-slate-100 text-slate-500 dark:bg-navy-800 dark:text-slate-400',
  success: 'bg-success-bg text-success dark:bg-success/15',
  danger: 'bg-danger-bg text-danger dark:bg-danger/15',
  warning: 'bg-warning-bg text-warning dark:bg-warning/15',
  accent: 'bg-blue-50 text-accent dark:bg-accent/15',
};

export function StatCard({ label, value, hint, icon: Icon, tone = 'neutral' }: StatCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className={cn('mt-1 text-xl font-extrabold leading-tight', TONES[tone])}>{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_BG[tone])}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
      </div>
    </div>
  );
}
