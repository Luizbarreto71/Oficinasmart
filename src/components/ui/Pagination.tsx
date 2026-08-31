import { cn } from '@/lib/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, onChange }: PaginationProps) {
  if (totalPages <= 1) {
    return (
      <div className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {total} {total === 1 ? 'registro' : 'registros'}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Página {page} de {totalPages} · {total} registros
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-navy-600 dark:hover:bg-navy-800',
          )}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-navy-600 dark:hover:bg-navy-800',
          )}
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
