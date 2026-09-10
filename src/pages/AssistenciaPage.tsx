import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { OrdemDetalhe } from '@/components/os/OrdemDetalhe';
import { OrdemFormModal } from '@/components/os/OrdemFormModal';
import { useUnit } from '@/contexts/UnitContext';
import { useOrdens } from '@/hooks/queries';
import { useAuth } from '@/contexts/AuthContext';
import type { OrdemFilters } from '@/services';
import { formatCurrency, formatRelative, OS_STATUS_TONE } from '@/lib/format';
import { pode } from '@/lib/permissoes';
import type { ServiceOrder } from '@/types';
import { Plus, Search, Wrench } from 'lucide-react';
import { useState } from 'react';

type Filtro = 'abertas' | 'PRONTO' | 'ENTREGUE' | 'todas';

const PILLS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'abertas', rotulo: 'Abertas' },
  { chave: 'PRONTO', rotulo: 'Prontas' },
  { chave: 'ENTREGUE', rotulo: 'Entregues' },
  { chave: 'todas', rotulo: 'Todas' },
];

export default function AssistenciaPage() {
  const { user } = useAuth();
  const { unidadeId } = useUnit();
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [busca, setBusca] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const params: OrdemFilters = {};
  if (busca.trim()) params.search = busca.trim();
  if (unidadeId) params.unitId = unidadeId;
  if (filtro === 'abertas') params.abertas = 'true';
  else if (filtro !== 'todas') params.status = filtro;

  const { data, isFetching } = useOrdens(params);
  const contadores = data?.contadores ?? {};

  const podeCriar = pode(user?.role, 'os.criar');

  const columns: TableColumn<ServiceOrder>[] = [
    { key: 'code', header: 'OS', render: (o) => <span className="font-semibold">{o.code}</span> },
    {
      key: 'aparelho',
      header: 'Aparelho',
      render: (o) => (
        <div className="min-w-0">
          <p className="truncate">{[o.deviceBrand, o.deviceModel].filter(Boolean).join(' ')}</p>
          <p className="truncate text-xs text-slate-400">{o.customerName}</p>
        </div>
      ),
    },
    { key: 'problema', header: 'Problema', hideOnMobile: true, render: (o) => <span className="line-clamp-1 text-slate-500">{o.reportedProblem}</span> },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      hideOnMobile: true,
      render: (o) => {
        const v = o.status === 'ENTREGUE' ? o.totalAmount : o.quotedValue ?? 0;
        return v ? formatCurrency(v) : '—';
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => <Badge tone={OS_STATUS_TONE[o.status] ?? 'neutral'}>{o.statusLabel}</Badge>,
    },
    { key: 'quando', header: 'Entrada', align: 'right', hideOnMobile: true, render: (o) => <span className="text-xs text-slate-400">{formatRelative(o.createdAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assistência técnica"
        subtitle="Ordens de serviço — do recebimento à entrega"
        actions={
          podeCriar && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNovaAberta(true)}>
              Nova OS
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {PILLS.map((p) => {
          const n =
            p.chave === 'abertas'
              ? contadores.ABERTAS
              : p.chave === 'todas'
                ? undefined
                : contadores[p.chave];
          return (
            <button
              key={p.chave}
              onClick={() => setFiltro(p.chave)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                filtro === p.chave
                  ? 'bg-accent text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-800 dark:text-slate-300'
              }`}
            >
              {p.rotulo}
              {typeof n === 'number' && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    filtro === p.chave ? 'bg-white/25' : 'bg-white text-slate-500 dark:bg-navy-900'
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código, cliente, IMEI…"
            className="pl-8"
          />
        </div>
      </div>

      <Card>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={!data && isFetching}
          rowKey={(o) => o.id}
          onRowClick={(o) => setDetalheId(o.id)}
          emptyMessage="Nenhuma ordem de serviço aqui"
          emptyAction={
            podeCriar ? (
              <Button size="sm" variant="outline" icon={<Wrench className="h-4 w-4" />} onClick={() => setNovaAberta(true)}>
                Abrir a primeira OS
              </Button>
            ) : undefined
          }
          mobileCard={(o) => (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {o.code} · {[o.deviceBrand, o.deviceModel].filter(Boolean).join(' ')}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {o.customerName} · {formatRelative(o.createdAt)}
                </p>
              </div>
              <Badge tone={OS_STATUS_TONE[o.status] ?? 'neutral'}>{o.statusLabel}</Badge>
            </div>
          )}
        />
      </Card>

      <OrdemFormModal open={novaAberta} onClose={() => setNovaAberta(false)} />
      {detalheId && <OrdemDetalhe ordemId={detalheId} onClose={() => setDetalheId(null)} />}
    </div>
  );
}
