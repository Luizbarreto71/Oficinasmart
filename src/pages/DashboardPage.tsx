import { MovementChart } from '@/components/dashboard/MovementChart';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FullScreenLoader } from '@/components/ui/Spinner';
import { StatCard } from '@/components/ui/StatCard';
import { useUnit } from '@/contexts/UnitContext';
import { useDashboard } from '@/hooks/queries';
import { formatCompactCurrency, formatCurrency, formatDateTime } from '@/lib/format';
import {
  AlertTriangle,
  Boxes,
  DollarSign,
  Package,
  PackageX,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';

const PERIODOS = [
  { value: 7, label: '7 dias' },
  { value: 14, label: '14 dias' },
  { value: 30, label: '30 dias' },
];

export default function DashboardPage() {
  const { unidadeId } = useUnit();
  const [dias, setDias] = useState(14);
  const { data, isLoading } = useDashboard(dias, unidadeId);

  if (isLoading || !data) return <FullScreenLoader />;

  const c = data.cards;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do estoque e das vendas"
        actions={
          <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-navy-600">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => setDias(p.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  dias === p.value
                    ? 'bg-accent text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Produtos" value={c.totalProducts} icon={Package} />
        <StatCard label="Itens em estoque" value={c.itemsInStock} icon={Boxes} />
        <StatCard label="Estoque a custo" value={formatCompactCurrency(c.stockValueCost)} icon={DollarSign} />
        <StatCard
          label="Lucro potencial"
          value={formatCompactCurrency(c.stockValueSale - c.stockValueCost)}
          hint={`Venda: ${formatCompactCurrency(c.stockValueSale)}`}
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          label="Vendas hoje"
          value={c.salesCountToday}
          hint={`${c.soldToday} itens`}
          icon={ShoppingCart}
          tone="accent"
        />
        <StatCard label="Faturamento hoje" value={formatCurrency(c.revenueToday)} tone="success" />
        <StatCard label="Faturamento do mês" value={formatCompactCurrency(c.revenueMonth)} tone="success" />
        <StatCard
          label="Lucro do mês"
          value={formatCompactCurrency(c.profitMonth)}
          hint={`${c.itemsSoldMonth} itens vendidos`}
          tone="success"
        />
        <StatCard
          label="Estoque baixo"
          value={c.lowStockCount}
          icon={AlertTriangle}
          tone={c.lowStockCount ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Sem estoque"
          value={c.outOfStockCount}
          icon={PackageX}
          tone={c.outOfStockCount ? 'danger' : 'neutral'}
        />
        <StatCard label="Entradas no período" value={c.entradas} />
        <StatCard label="Saídas no período" value={c.saidas} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Faturamento" subtitle={`Últimos ${dias} dias`} />
          <CardBody>
            <MovementChart data={data.chart} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Estoque por categoria" />
          <CardBody className="space-y-2">
            {data.categories.length === 0 && <p className="text-sm text-slate-500">Sem dados.</p>}
            {data.categories
              .sort((a, b) => b.quantity - a.quantity)
              .map((cat) => (
                <div key={cat.categoryId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                    <span className="truncate">{cat.name}</span>
                  </span>
                  <span className="shrink-0 font-semibold">{cat.quantity}</span>
                </div>
              ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Últimas vendas" />
          <CardBody className="space-y-2">
            {data.latestSales.length === 0 && <p className="text-sm text-slate-500">Nenhuma venda ainda.</p>}
            {data.latestSales.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{v.code}</span>
                  <span className="ml-2 text-slate-500">{v.customerName ?? 'Consumidor'}</span>
                  <span className="ml-1 block text-xs text-slate-400 sm:hidden">{formatDateTime(v.saleDate)}</span>
                </span>
                <span className="shrink-0 font-semibold text-success">{formatCurrency(v.totalAmount)}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Estoque baixo"
            action={<Badge tone={data.lowStockProducts.length ? 'warning' : 'neutral'}>{data.lowStockProducts.length}</Badge>}
          />
          <CardBody className="space-y-2">
            {data.lowStockProducts.length === 0 && (
              <p className="text-sm text-slate-500">Nada abaixo do mínimo. 👍</p>
            )}
            {data.lowStockProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0">
                  <Badge tone="warning">
                    {p.quantity} / {p.minQuantity}
                  </Badge>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
