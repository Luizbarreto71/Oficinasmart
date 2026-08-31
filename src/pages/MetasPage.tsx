import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { InlineLoader } from '@/components/ui/Spinner';
import { StatCard } from '@/components/ui/StatCard';
import { useUnit } from '@/contexts/UnitContext';
import { useMetas } from '@/hooks/queries';
import { formatCurrency } from '@/lib/format';
import { toInputDate } from '@/lib/format';
import { useMemo, useState } from 'react';

export default function MetasPage() {
  const { unidadeId } = useUnit();
  const hoje = toInputDate(new Date());
  const [inicio, setInicio] = useState(hoje);
  const [fim, setFim] = useState(hoje);

  const { data, isLoading } = useMetas(
    useMemo(() => ({ inicio, fim, unitId: unidadeId ?? undefined }), [inicio, fim, unidadeId]),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metas de venda"
        subtitle={data ? `${data.rotulo} · meta de ${data.meta} aparelhos/dia` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9 w-40" />
            <span className="text-slate-400">até</span>
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9 w-40" />
          </div>
        }
      />

      {isLoading || !data ? (
        <InlineLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Vendedores" value={data.resumo.vendedores} />
            <StatCard label="Bateram a meta" value={data.resumo.bateram} tone="success" />
            <StatCard label="Aparelhos vendidos" value={data.resumo.aparelhos} />
            <StatCard label="Faturamento" value={formatCurrency(data.resumo.faturamento)} tone="success" />
          </div>

          {data.parecidos.length > 0 && (
            <Card className="border-warning/40 bg-warning-bg/40 p-3 text-sm text-warning dark:bg-warning/10">
              Nomes parecidos (podem ser a mesma pessoa):{' '}
              {data.parecidos.map((par) => par.join(' ≈ ')).join(' · ')}
            </Card>
          )}

          <Card>
            <CardHeader title="Placar" />
            <CardBody className="space-y-3">
              {data.vendedores.length === 0 && <p className="text-sm text-slate-500">Nenhuma venda no período.</p>}
              {data.vendedores.map((v) => (
                <div key={v.chave} className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      {v.nome}
                      {v.atingiu && <Badge tone="success">meta batida</Badge>}
                    </span>
                    <span className="text-sm">
                      <strong>{v.aparelhos}</strong> aparelhos · {formatCurrency(v.faturamento)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                    <div
                      className={`h-full rounded-full ${v.atingiu ? 'bg-success' : 'bg-accent'}`}
                      style={{ width: `${Math.min(100, v.progresso)}%` }}
                    />
                  </div>
                  {data.umDia && !v.atingiu && (
                    <p className="mt-1 text-xs text-slate-500">Faltam {v.faltam} para a meta.</p>
                  )}
                  {!data.umDia && (
                    <p className="mt-1 text-xs text-slate-500">
                      Bateu a meta em {v.diasBatidos} de {v.diasComVenda} dia(s) com venda.
                    </p>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
