import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300',
  success: 'bg-success-bg text-success dark:bg-success/15 dark:text-success-soft',
  danger: 'bg-danger-bg text-danger dark:bg-danger/15 dark:text-danger-soft',
  warning: 'bg-warning-bg text-warning dark:bg-warning/15 dark:text-warning-soft',
  info: 'bg-blue-50 text-accent dark:bg-accent/15 dark:text-accent-soft',
  accent: 'bg-accent text-white',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
