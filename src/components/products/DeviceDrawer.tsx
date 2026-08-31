import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useDeviceAction, useDevices } from '@/hooks/queries';
import { DEVICE_STATUS_LABEL } from '@/lib/format';
import type { DeviceStatus, Product } from '@/types';
import { BatteryMedium, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

const TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  EM_ESTOQUE: 'success',
  VENDIDO: 'neutral',
  DEFEITO: 'danger',
  DEVOLVIDO: 'warning',
  EM_TRANSITO: 'info',
  RESERVADO: 'warning',
};

export function DeviceDrawer({ open, onClose, produto }: { open: boolean; onClose: () => void; produto: Product | null }) {
  const { success, error } = useToast();
  const { unidades, unidadeId } = useUnit();
  const { data, isLoading } = useDevices(produto ? { productId: produto.id, page: 1 } : {});
  const entrada = useDeviceAction('entrada');
  const baixa = useDeviceAction('baixa');
  const retornar = useDeviceAction('retornar');
  const remover = useDeviceAction('remove');

  const [novo, setNovo] = useState({ imei: '', serialNumber: '', condicao: 'Novo / Lacrado', batteryHealth: '', costPrice: '', unitId: unidadeId ?? '' });

  if (!produto) return null;

  const darEntrada = async () => {
    if (!novo.unitId) return error('Escolha a unidade.');
    try {
      await entrada.mutateAsync({
        data: {
          productId: produto.id,
          unitId: novo.unitId,
          aparelhos: [
            {
              imei: novo.imei.replace(/\D/g, '') || null,
              serialNumber: novo.serialNumber || null,
              condicao: novo.condicao || null,
              batteryHealth: novo.batteryHealth ? Number(novo.batteryHealth) : null,
              costPrice: novo.costPrice ? Number(novo.costPrice) : Number(produto.costPrice) || 0,
            },
          ],
        },
      });
      success('Aparelho cadastrado.');
      setNovo({ ...novo, imei: '', serialNumber: '', batteryHealth: '', costPrice: '' });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Aparelhos — ${produto.name}`} size="xl">
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-navy-700 dark:bg-navy-800/40">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Dar entrada de um aparelho</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Input placeholder="IMEI" value={novo.imei} onChange={(e) => setNovo({ ...novo, imei: e.target.value })} />
            <Input placeholder="Nº série" value={novo.serialNumber} onChange={(e) => setNovo({ ...novo, serialNumber: e.target.value })} />
            <Input placeholder="Condição" value={novo.condicao} onChange={(e) => setNovo({ ...novo, condicao: e.target.value })} />
            <Input placeholder="Bateria %" type="number" value={novo.batteryHealth} onChange={(e) => setNovo({ ...novo, batteryHealth: e.target.value })} />
            <Input placeholder="Custo" type="number" step="0.01" value={novo.costPrice} onChange={(e) => setNovo({ ...novo, costPrice: e.target.value })} />
            <Select
              value={novo.unitId}
              onChange={(e) => setNovo({ ...novo, unitId: e.target.value })}
              placeholder="Unidade"
              options={unidades.map((u) => ({ value: u.id, label: u.name }))}
            />
          </div>
          <div className="mt-2">
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={darEntrada} loading={entrada.isPending}>
              Cadastrar aparelho
            </Button>
          </div>
        </div>

        {isLoading ? (
          <InlineLoader />
        ) : !data?.data.length ? (
          <p className="py-8 text-center text-sm text-slate-500">Nenhum aparelho cadastrado ainda.</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-navy-700">
                  <th className="py-2 pr-2">IMEI / série</th>
                  <th className="py-2 pr-2">Unidade</th>
                  <th className="py-2 pr-2">Condição</th>
                  <th className="py-2 pr-2">Bateria</th>
                  <th className="py-2 pr-2">Custo</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-800">
                {data.data.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-2 font-mono text-xs">{d.imei ?? d.serialNumber ?? '—'}</td>
                    <td className="py-2 pr-2">{d.unit?.name ?? '—'}</td>
                    <td className="py-2 pr-2">{d.condicao ?? '—'}</td>
                    <td className="py-2 pr-2">
                      {d.batteryHealth != null ? (
                        <span className="inline-flex items-center gap-1">
                          <BatteryMedium className="h-3.5 w-3.5 text-slate-400" />
                          {d.batteryHealth}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-2">R$ {Number(d.costPrice).toFixed(2)}</td>
                    <td className="py-2 pr-2">
                      <Badge tone={TONE[d.status] ?? 'neutral'}>{DEVICE_STATUS_LABEL[d.status] ?? d.status}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      {d.status === 'EM_ESTOQUE' && (
                        <button
                          onClick={() =>
                            baixa
                              .mutateAsync({ id: d.id, data: { motivo: 'DEFEITO' } })
                              .then((r) => success((r.message as string) ?? 'Baixado'))
                              .catch((e) => error(e.message))
                          }
                          className="rounded p-1 text-warning hover:bg-warning-bg"
                          title="Baixar (defeito)"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {(d.status === 'DEFEITO' || d.status === 'DEVOLVIDO') && (
                        <button
                          onClick={() =>
                            retornar
                              .mutateAsync({ id: d.id })
                              .then((r) => success((r.message as string) ?? 'De volta ao estoque'))
                              .catch((e) => error(e.message))
                          }
                          className="rounded p-1 text-success hover:bg-success-bg"
                          title="Voltar ao estoque"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                      {d.status !== 'VENDIDO' && (
                        <button
                          onClick={() =>
                            remover
                              .mutateAsync({ id: d.id })
                              .then(() => success('Aparelho excluído'))
                              .catch((e) => error(e.message))
                          }
                          className="rounded p-1 text-danger hover:bg-danger-bg"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export type { DeviceStatus };
