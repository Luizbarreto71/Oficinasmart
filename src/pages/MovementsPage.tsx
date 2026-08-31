import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useUnit } from '@/contexts/UnitContext';
import { useMovements } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { MOVEMENT_LABEL, REASON_LABEL, formatDateTime } from '@/lib/format';
import type { Movement } from '@/types';
import { useMemo, useState } from 'react';

const TONE: Record<string, 'success' | 'danger' | 'info' | 'warning'> = {
  ENTRADA: 'success',
  SAIDA: 'danger',
  TRANSFERENCIA: 'info',
  AJUSTE: 'warning',
};

export default function MovementsPage() {
  const { unidadeId } = useUnit();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const debounced = useDebounce(search, 350);

  const filtros = useMemo(
    () => ({ page, search: debounced || undefined, type: type || undefined, unitId: unidadeId ?? undefined }),
    [page, debounced, type, unidadeId],
  );
  const { data, isLoading } = useMovements(filtros);

  const columns: TableColumn<Movement>[] = [
    { key: 'date', header: 'Data', render: (m) => <span className="text-xs">{formatDateTime(m.createdAt)}</span> },
    {
      key: 'type',
      header: 'Tipo',
      render: (m) => <Badge tone={TONE[m.type] ?? 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge>,
    },
    { key: 'reason', header: 'Motivo', hideOnMobile: true, render: (m) => REASON_LABEL[m.reason] ?? m.reason },
    { key: 'product', header: 'Produto', render: (m) => m.productName ?? '—' },
    { key: 'unit', header: 'Unidade', hideOnMobile: true, render: (m) => m.unit?.name ?? '—' },
    {
      key: 'qty',
      header: 'Qtd',
      align: 'right',
      render: (m) => (
        <span className={m.type === 'ENTRADA' ? 'text-success' : m.type === 'SAIDA' ? 'text-danger' : ''}>
          {m.type === 'SAIDA' ? '−' : m.type === 'ENTRADA' ? '+' : ''}
          {m.quantity}
        </span>
      ),
    },
    { key: 'saldo', header: 'Saldo', align: 'right', hideOnMobile: true, render: (m) => m.newQuantity ?? '—' },
    { key: 'user', header: 'Usuário', hideOnMobile: true, render: (m) => m.user?.name ?? '—' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Histórico de movimentações" subtitle={data ? `${data.meta.total} lançamentos` : undefined} />

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            placeholder="Buscar produto ou observação…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            placeholder="Todos os tipos"
            options={Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </Card>

      <Card>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={isLoading}
          rowKey={(m) => m.id}
          emptyMessage="Sem movimentações"
          mobileCard={(m) => (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.productName}</p>
                <p className="text-xs text-slate-400">{formatDateTime(m.createdAt)}</p>
              </div>
              <Badge tone={TONE[m.type] ?? 'neutral'}>
                {m.type === 'SAIDA' ? '−' : '+'}
                {m.quantity}
              </Badge>
            </div>
          )}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
      </Card>
    </div>
  );
}
