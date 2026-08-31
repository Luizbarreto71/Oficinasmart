import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useEmAberto, useEmAbertoAction } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCurrency, formatDate } from '@/lib/format';
import { useMemo, useState } from 'react';

interface Cobranca {
  id: string;
  amount: number;
  dias: number;
  vendedor?: string | null;
  produtos?: string;
  settledAt?: string | null;
  sale: { code: string; saleDate: string; customerName?: string | null; customerPhone?: string | null };
}

export default function EmAbertoPage() {
  const { unidadeId } = useUnit();
  const { success, error } = useToast();
  const [, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [situacao, setSituacao] = useState('abertos');
  const debounced = useDebounce(search, 350);

  const { data, isLoading } = useEmAberto(
    useMemo(() => ({ search: debounced || undefined, situacao, unitId: unidadeId ?? undefined }), [debounced, situacao, unidadeId]),
  );
  const receber = useEmAbertoAction('receber');
  const reabrir = useEmAbertoAction('reabrir');

  const linhas = (data?.data ?? []) as unknown as Cobranca[];

  const columns: TableColumn<Cobranca>[] = [
    { key: 'code', header: 'Venda', render: (c) => c.sale.code },
    { key: 'cliente', header: 'Cliente', render: (c) => c.sale.customerName ?? '—' },
    { key: 'produtos', header: 'Produtos', hideOnMobile: true, render: (c) => <span className="text-xs">{c.produtos}</span> },
    { key: 'data', header: 'Data', hideOnMobile: true, render: (c) => formatDate(c.sale.saleDate) },
    {
      key: 'dias',
      header: 'Aberto há',
      render: (c) => (c.settledAt ? <Badge tone="success">Quitado</Badge> : <Badge tone={c.dias > 15 ? 'danger' : 'warning'}>{c.dias} dias</Badge>),
    },
    { key: 'valor', header: 'Valor', align: 'right', render: (c) => <strong>{formatCurrency(c.amount)}</strong> },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (c) =>
        c.settledAt ? (
          <Button size="sm" variant="ghost" onClick={() => reabrir.mutate({ id: c.id }, { onSuccess: (r) => success(r.message), onError: (e) => error(e.message) })}>
            Reabrir
          </Button>
        ) : (
          <Button
            size="sm"
            variant="success"
            onClick={() => receber.mutate({ id: c.id, method: 'DINHEIRO' }, { onSuccess: (r) => success(r.message), onError: (e) => error(e.message) })}
          >
            Receber
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Valores em aberto" subtitle="Vendas fiado ainda não quitadas" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Cobranças abertas" value={data?.resumo.cobrancas ?? 0} tone="warning" />
        <StatCard label="Total a receber" value={formatCurrency(data?.resumo.total ?? 0)} tone="danger" />
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Buscar cliente ou venda…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
            options={[
              { value: 'abertos', label: 'Em aberto' },
              { value: 'quitados', label: 'Quitados' },
              { value: 'todos', label: 'Todos' },
            ]}
          />
        </div>
      </Card>

      <Card>
        <DataTable columns={columns} data={linhas} loading={isLoading} rowKey={(c) => c.id} emptyMessage="Nada em aberto 👍" />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
      </Card>
    </div>
  );
}
