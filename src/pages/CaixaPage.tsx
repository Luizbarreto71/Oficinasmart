import { SaleModal } from '@/components/vendas/SaleModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import {
  useAcaoDeCaixa,
  useAtenderPreVenda,
  useCaixaAtual,
  useFinalizarPreVenda,
  usePreVendas,
} from '@/hooks/queries';
import { caixaService } from '@/services';
import { PAYMENT_LABEL, PAYMENT_OPTIONS, PRE_SALE_LABEL, formatCurrency } from '@/lib/format';
import type { PreSale } from '@/types';
import { CheckCircle2, Plus } from 'lucide-react';
import { useState } from 'react';

export default function CaixaPage() {
  const { success, error } = useToast();
  const { unidades, unidadeId } = useUnit();
  const { data: caixa } = useCaixaAtual();
  const { data: fila } = usePreVendas({ status: 'AGUARDANDO_CAIXA,EM_ATENDIMENTO' });

  const abrir = useAcaoDeCaixa((v: { unitId?: string }) => caixaService.abrir(v));
  const fechar = useAcaoDeCaixa(() => caixaService.fechar());
  const atender = useAtenderPreVenda();
  const finalizar = useFinalizarPreVenda();

  const [vendaOpen, setVendaOpen] = useState(false);
  const [finalizando, setFinalizando] = useState<PreSale | null>(null);
  const [pagamento, setPagamento] = useState('DINHEIRO');

  const aberto = caixa?.aberto;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Caixa"
        subtitle={aberto ? `Turno ${caixa!.turno!.code} aberto` : 'Nenhum turno aberto'}
        actions={
          aberto ? (
            <div className="flex gap-2">
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setVendaOpen(true)}>
                Venda no balcão
              </Button>
              <Button
                variant="danger"
                onClick={() => fechar.mutate({} as never, { onSuccess: (r) => success(r.message), onError: (e) => error(e.message) })}
                loading={fechar.isPending}
              >
                Fechar caixa
              </Button>
            </div>
          ) : (
            <Button
              onClick={() =>
                abrir.mutate(
                  { unitId: unidadeId ?? unidades[0]?.id },
                  { onSuccess: (r) => success(r.message), onError: (e) => error(e.message) },
                )
              }
              loading={abrir.isPending}
            >
              Abrir caixa
            </Button>
          )
        }
      />

      {aberto && caixa?.resumo && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Vendas no turno" value={caixa.resumo.quantidadeDeVendas} />
          <StatCard label="Total" value={formatCurrency(caixa.resumo.total)} tone="success" />
          <StatCard label="Ticket médio" value={formatCurrency(caixa.resumo.ticketMedio)} />
          <StatCard label="Lucro estimado" value={formatCurrency(caixa.resumo.lucro)} tone="success" />
        </div>
      )}

      <Card>
        <CardHeader title="Fila do caixa" subtitle="Pré-vendas aguardando pagamento" />
        <CardBody className="space-y-2">
          {!fila?.data.length && <p className="text-sm text-slate-500">Nenhuma pré-venda na fila.</p>}
          {fila?.data.map((pv) => (
            <div key={pv.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-navy-700 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">
                  {pv.code} · {pv.customerName}{' '}
                  <Badge tone={pv.status === 'AGUARDANDO_CAIXA' ? 'warning' : 'info'}>{PRE_SALE_LABEL[pv.status]}</Badge>
                </p>
                <p className="text-xs text-slate-400">
                  {pv.items.map((i) => `${i.quantity}× ${i.productName ?? i.product?.name}`).join(', ')} ·{' '}
                  {formatCurrency(pv.totalAmount)}
                </p>
              </div>
              <div className="flex gap-2">
                {pv.status === 'AGUARDANDO_CAIXA' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => atender.mutate(pv.id, { onError: (e) => error(e.message) })}
                  >
                    Atender
                  </Button>
                )}
                <Button size="sm" variant="success" onClick={() => setFinalizando(pv)}>
                  Cobrar
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <SaleModal open={vendaOpen} onClose={() => setVendaOpen(false)} />

      <Modal
        open={Boolean(finalizando)}
        onClose={() => setFinalizando(null)}
        title={`Finalizar ${finalizando?.code}`}
        subtitle={finalizando ? `${finalizando.customerName} · ${formatCurrency(finalizando.totalAmount)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinalizando(null)}>Cancelar</Button>
            <Button
              variant="success"
              icon={<CheckCircle2 className="h-4 w-4" />}
              loading={finalizar.isPending}
              onClick={() => {
                if (!finalizando) return;
                finalizar.mutate(
                  {
                    id: finalizando.id,
                    dados: {
                      unitId: finalizando.unit?.id ?? unidadeId ?? unidades[0]?.id,
                      paymentMethod: pagamento,
                      installments: 1,
                      items: finalizando.items.map((i) => ({
                        productId: i.productId,
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                        deviceId: i.deviceId ?? null,
                        imei: i.imei ?? null,
                      })),
                    },
                  },
                  {
                    onSuccess: (r) => {
                      success(r.message);
                      setFinalizando(null);
                    },
                    onError: (e) => error(e.message),
                  },
                );
              }}
            >
              Confirmar pagamento
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-navy-800/40">
            {finalizando?.items.map((i, k) => (
              <div key={k} className="flex justify-between">
                <span>{i.quantity}× {i.productName ?? i.product?.name}</span>
                <span>{formatCurrency(i.unitPrice * i.quantity)}</span>
              </div>
            ))}
          </div>
          <Select
            options={PAYMENT_OPTIONS}
            value={pagamento}
            onChange={(e) => setPagamento(e.target.value)}
          />
          {finalizando?.tradeIn && (
            <p className="text-xs text-slate-500">
              Troca {finalizando.tradeIn.code} de {formatCurrency(finalizando.tradeIn.valorAvaliado)} já abatida.
            </p>
          )}
          <p className="text-xs text-slate-400">Forma escolhida: {PAYMENT_LABEL[pagamento as never]}</p>
        </div>
      </Modal>
    </div>
  );
}
