import { DeviceDrawer } from '@/components/products/DeviceDrawer';
import { ProductFormModal } from '@/components/products/ProductFormModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useCategories, useDeleteProduct, useProducts } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCurrency, profitMargin } from '@/lib/format';
import { pode } from '@/lib/permissoes';
import type { Product } from '@/types';
import { Package, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function StockPage() {
  const { user } = useAuth();
  const { unidadeId } = useUnit();
  const { success, error } = useToast();
  const { data: categorias } = useCategories();
  const excluir = useDeleteProduct();

  const [page, setPage] = useState(1);
  const [busca, setBusca] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tipoControle, setTipoControle] = useState('');
  const [status, setStatus] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const buscaDebounced = useDebounce(busca, 350);

  const filtros = useMemo(
    () => ({
      page,
      search: buscaDebounced || undefined,
      categoryId: categoryId || undefined,
      tipoControle: tipoControle || undefined,
      status: status || undefined,
      lowStock: lowStock ? 'true' : undefined,
      unitId: unidadeId ?? undefined,
      sortBy,
      sortOrder,
    }),
    [page, buscaDebounced, categoryId, tipoControle, status, lowStock, unidadeId, sortBy, sortOrder],
  );

  const { data, isLoading } = useProducts(filtros);

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<Product | null>(null);
  const [devicesDe, setDevicesDe] = useState<Product | null>(null);
  const [excluindo, setExcluindo] = useState<Product | null>(null);

  const podeEditar = pode(user?.role, 'produtos.editar');
  const podeExcluir = user?.role === 'ADMIN';

  const ordenar = (key: string) => {
    if (sortBy === key) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortOrder('asc');
    }
  };

  const columns: TableColumn<Product>[] = [
    {
      key: 'name',
      header: 'Produto',
      sortKey: 'name',
      render: (p) => (
        <div className="flex items-center gap-3">
          {p.photos[0] ? (
            <img src={p.photos[0]} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-navy-800">
              {p.tipoControle === 'UNITARIO' ? <Smartphone className="h-5 w-5" /> : <Package className="h-5 w-5" />}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-navy-900 dark:text-slate-100">{p.name}</p>
            <p className="truncate text-xs text-slate-400">
              {[p.brand, p.model, p.capacity].filter(Boolean).join(' · ') || p.category?.name}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Categoria', hideOnMobile: true, render: (p) => p.category?.name ?? '—' },
    {
      key: 'tipo',
      header: 'Tipo',
      hideOnMobile: true,
      render: (p) => (
        <Badge tone={p.tipoControle === 'UNITARIO' ? 'info' : 'neutral'}>
          {p.tipoControle === 'UNITARIO' ? 'Aparelho' : 'Quantidade'}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Qtd',
      align: 'right',
      render: (p) =>
        p.semEstoque ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className={p.quantity <= p.minQuantity ? 'font-bold text-warning' : ''}>{p.quantity}</span>
        ),
    },
    {
      key: 'costPrice',
      header: 'Custo',
      align: 'right',
      sortKey: 'costPrice',
      hideOnMobile: true,
      render: (p) => formatCurrency(p.costPrice),
    },
    {
      key: 'salePrice',
      header: 'Venda',
      align: 'right',
      sortKey: 'salePrice',
      render: (p) => formatCurrency(p.salePrice || p.wholesalePrice || 0),
    },
    {
      key: 'margem',
      header: 'Margem',
      align: 'right',
      hideOnMobile: true,
      render: (p) => {
        const m = profitMargin(p.costPrice, p.salePrice || p.wholesalePrice || 0);
        return <span className={m >= 0 ? 'text-success' : 'text-danger'}>{m.toFixed(0)}%</span>;
      },
    },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.tipoControle === 'UNITARIO' && (
            <button
              onClick={() => setDevicesDe(p)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-accent dark:hover:bg-navy-800"
              title="Aparelhos"
            >
              <Smartphone className="h-4 w-4" />
            </button>
          )}
          {podeEditar && (
            <button
              onClick={() => {
                setEditando(p);
                setFormOpen(true);
              }}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-accent dark:hover:bg-navy-800"
              title="Editar"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {podeExcluir && (
            <button
              onClick={() => setExcluindo(p)}
              className="rounded p-1.5 text-slate-500 hover:bg-danger-bg hover:text-danger"
              title="Excluir"
            >
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
        title="Estoque"
        subtitle={data ? `${data.meta.total} produtos` : undefined}
        actions={
          podeEditar && (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditando(null);
                setFormOpen(true);
              }}
            >
              Novo produto
            </Button>
          )
        }
      />

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            placeholder="Buscar por nome, IMEI, série…"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            placeholder="Todas as categorias"
            options={(categorias ?? []).filter((c) => !c.ehSubcategoria).map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            value={tipoControle}
            onChange={(e) => {
              setTipoControle(e.target.value);
              setPage(1);
            }}
            placeholder="Todos os tipos"
            options={[
              { value: 'UNITARIO', label: 'Por aparelho' },
              { value: 'QUANTIDADE', label: 'Por quantidade' },
            ]}
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            placeholder="Todos os status"
            options={[
              { value: 'EM_ESTOQUE', label: 'Em estoque' },
              { value: 'VENDIDO', label: 'Vendido' },
            ]}
          />
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm dark:border-navy-600">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => {
                setLowStock(e.target.checked);
                setPage(1);
              }}
            />
            Só estoque baixo
          </label>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={isLoading}
          rowKey={(p) => p.id}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={ordenar}
          emptyMessage="Nenhum produto encontrado"
          mobileCard={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="truncate text-xs text-slate-400">
                  {p.category?.name} · {p.tipoControle === 'UNITARIO' ? 'aparelho' : `${p.quantity} un.`}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold">{formatCurrency(p.salePrice || p.wholesalePrice || 0)}</span>
            </div>
          )}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
      </Card>

      <ProductFormModal open={formOpen} onClose={() => setFormOpen(false)} produto={editando} />
      <DeviceDrawer open={Boolean(devicesDe)} onClose={() => setDevicesDe(null)} produto={devicesDe} />
      <ConfirmDialog
        open={Boolean(excluindo)}
        onClose={() => setExcluindo(null)}
        title={`Excluir ${excluindo?.name}?`}
        message="Se o produto já teve vendas, ele é apenas arquivado — o histórico é mantido."
        confirmLabel="Excluir"
        askReason
        loading={excluir.isPending}
        onConfirm={async (reason) => {
          if (!excluindo) return;
          try {
            const r = await excluir.mutateAsync({ id: excluindo.id, reason });
            success(r.message);
            setExcluindo(null);
          } catch (e) {
            error(e instanceof Error ? e.message : 'Erro');
          }
        }}
      />
    </div>
  );
}
