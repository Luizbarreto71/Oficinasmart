import { SaleModal } from '@/components/vendas/SaleModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useDeleteSale, useSales } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { openPdf } from '@/lib/api';
import { PAYMENT_LABEL, formatCurrency, formatDateTime } from '@/lib/format';
import { pode } from '@/lib/permissoes';
import type { Sale } from '@/types';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function SalesPage() {
  const { user } = useAuth();
  const { unidadeId } = useUnit();
  const { success, error } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 350);
  const { data, isLoading } = useSales(useMemo(() => ({ page, search: debounced || undefined, unitId: unidadeId ?? undefined }), [page, debounced, unidadeId]));

  const [vendaOpen, setVendaOpen] = useState(false);
  const [cancelando, setCancelando] = useState<Sale | null>(null);
  const cancelar = useDeleteSale();

  const podeVender = pode(user?.role, 'pdv');
  const podeCancelar = pode(user?.role, 'venda.cancelar');

  const columns: TableColumn<Sale>[] = [
    { key: 'code', header: 'Venda', render: (v) => <span className="font-medium">{v.code}</span> },
    { key: 'date', header: 'Data', hideOnMobile: true, render: (v) => <span className="text-xs">{formatDateTime(v.saleDate)}</span> },
    { key: 'cliente', header: 'Cliente', render: (v) => v.customerName ?? 'Consumidor' },
    {
      key: 'itens',
      header: 'Itens',
      hideOnMobile: true,
      render: (v) => v.items.map((i) => `${i.quantity}× ${i.productName}`).join(', '),
    },
    { key: 'pgto', header: 'Pagamento', hideOnMobile: true, render: (v) => <Badge>{PAYMENT_LABEL[v.paymentMethod]}</Badge> },
    { key: 'total', header: 'Total', align: 'right', render: (v) => <strong className="text-success">{formatCurrency(v.totalAmount)}</strong> },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openPdf(`/sales/${v.id}/recibo`)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-accent dark:hover:bg-navy-800" title="Recibo">
            <FileText className="h-4 w-4" />
          </button>
          {podeCancelar && v.status === 'FINALIZADA' && (
            <button onClick={() => setCancelando(v)} className="rounded p-1.5 text-slate-500 hover:bg-danger-bg hover:text-danger" title="Cancelar venda">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendas"
        subtitle={data ? `${data.meta.total} vendas` : undefined}
        actions={podeVender && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setVendaOpen(true)}>Nova venda</Button>}
      />

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Faturamento" value={formatCurrency(data.totals.revenue)} tone="success" />
          <StatCard label="Lucro" value={formatCurrency(data.totals.profit)} tone="success" />
          <StatCard label="Itens vendidos" value={data.totals.items} />
        </div>
      )}

      <Card className="p-3">
        <Input placeholder="Buscar por venda, cliente, IMEI, produto…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </Card>

      <Card>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={isLoading}
          rowKey={(v) => v.id}
          emptyMessage="Nenhuma venda"
          mobileCard={(v) => (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{v.code} · {v.customerName ?? 'Consumidor'}</p>
                <p className="text-xs text-slate-400">{formatDateTime(v.saleDate)}</p>
              </div>
              <span className="shrink-0 font-semibold text-success">{formatCurrency(v.totalAmount)}</span>
            </div>
          )}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
      </Card>

      <SaleModal open={vendaOpen} onClose={() => setVendaOpen(false)} />

      <ConfirmDialog
        open={Boolean(cancelando)}
        onClose={() => setCancelando(null)}
        title={`Cancelar ${cancelando?.code}?`}
        message="Os produtos voltam ao estoque e a venda vira CANCELADA (não é apagada)."
        confirmLabel="Cancelar venda"
        askReason
        loading={cancelar.isPending}
        onConfirm={async (reason) => {
          if (!cancelando) return;
          try {
            const r = await cancelar.mutateAsync({ id: cancelando.id, reason });
            success(r.message);
            setCancelando(null);
          } catch (e) {
            error(e instanceof Error ? e.message : 'Erro');
          }
        }}
      />
    </div>
  );
}
