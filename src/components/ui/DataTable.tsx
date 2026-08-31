import { cn } from '@/lib/cn';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  hideOnMobile?: boolean;
  render: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  rowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  mobileCard?: (item: T) => ReactNode;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({
  columns,
  data,
  loading,
  rowKey,
  onRowClick,
  sortBy,
  sortOrder,
  onSort,
  emptyMessage = 'Nenhum registro encontrado',
  emptyAction,
  mobileCard,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-navy-800">
          <Inbox className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <>
      {mobileCard && (
        <div className="divide-y divide-slate-200 dark:divide-navy-700 md:hidden">
          {data.map((item) => (
            <div
              key={rowKey(item)}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              className={cn('p-4', onRowClick && 'cursor-pointer active:bg-slate-50 dark:active:bg-navy-800')}
            >
              {mobileCard(item)}
            </div>
          ))}
        </div>
      )}

      <div className={cn('table-wrap', mobileCard && 'hidden md:block')}>
        <table className="w-full min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-navy-700 dark:bg-navy-800/60">
              {columns.map((column) => {
                const sortable = Boolean(column.sortKey && onSort);
                const active = column.sortKey && sortBy === column.sortKey;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400',
                      ALIGN[column.align ?? 'left'],
                      column.hideOnMobile && 'hidden lg:table-cell',
                      sortable && 'cursor-pointer select-none transition hover:text-navy-900 dark:hover:text-slate-100',
                      column.className,
                    )}
                    onClick={sortable ? () => onSort?.(column.sortKey!) : undefined}
                    aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className={cn('inline-flex items-center gap-1', column.align === 'right' && 'flex-row-reverse')}>
                      {column.header}
                      {sortable &&
                        (active ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-accent" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 dark:divide-navy-700">
            {data.map((item) => (
              <tr
                key={rowKey(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={cn(
                  'transition-colors hover:bg-slate-50 dark:hover:bg-navy-800/60',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 text-navy-800 dark:text-slate-200',
                      ALIGN[column.align ?? 'left'],
                      column.hideOnMobile && 'hidden lg:table-cell',
                    )}
                  >
                    {column.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
