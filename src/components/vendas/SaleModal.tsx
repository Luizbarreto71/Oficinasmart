import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useCreateSale } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { deviceService, productService } from '@/services';
import { PAYMENT_OPTIONS, formatCurrency } from '@/lib/format';
import type { DeviceUnit, Product } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

interface Linha {
  productId: string;
  nome: string;
  tipoControle: 'UNITARIO' | 'QUANTIDADE';
  quantity: number;
  unitPrice: number;
  deviceId?: string;
  imei?: string;
}

export function SaleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { success, error } = useToast();
  const { unidadeId, unidades } = useUnit();
  const criar = useCreateSale();

  const [itens, setItens] = useState<Linha[]>([]);
  const [busca, setBusca] = useState('');
  const debounced = useDebounce(busca, 300);
  const [cliente, setCliente] = useState({ name: '', phone: '' });
  const [pagamento, setPagamento] = useState('DINHEIRO');
  const [parcelas, setParcelas] = useState('1');
  const [vendedor, setVendedor] = useState('');
  const [unitId, setUnitId] = useState(unidadeId ?? (unidades[0]?.id ?? ''));

  const { data: resultados } = useQuery({
    queryKey: ['venda-busca', debounced],
    queryFn: () => productService.list({ search: debounced, pageSize: 12, status: 'EM_ESTOQUE' }),
    enabled: open && debounced.length >= 2,
  });

  const total = useMemo(() => itens.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [itens]);

  const adicionar = async (p: Product) => {
    if (p.tipoControle === 'UNITARIO') {
      const devs = await deviceService.list({ productId: p.id, status: 'EM_ESTOQUE', unitId: unitId || undefined });
      const disponivel = devs.data[0];
      if (!disponivel) return error(`Nenhum aparelho de "${p.name}" em estoque nesta unidade.`);
      setItens((v) => [
        ...v,
        {
          productId: p.id,
          nome: p.name,
          tipoControle: 'UNITARIO',
          quantity: 1,
          unitPrice: Number(disponivel.salePrice ?? p.salePrice ?? p.wholesalePrice ?? 0),
          deviceId: disponivel.id,
          imei: disponivel.imei ?? undefined,
        },
      ]);
    } else {
      setItens((v) => [
        ...v,
        {
          productId: p.id,
          nome: p.name,
          tipoControle: 'QUANTIDADE',
          quantity: 1,
          unitPrice: Number(p.salePrice || p.wholesalePrice || 0),
        },
      ]);
    }
    setBusca('');
  };

  const trocarAparelho = async (idx: number, imei: string) => {
    const r = await deviceService.porImei(imei);
    if (!r.encontrado || !r.device) return error('IMEI não encontrado no estoque.');
    const d = r.device as DeviceUnit;
    if (d.status !== 'EM_ESTOQUE') return error('Esse aparelho não está disponível.');
    setItens((v) => v.map((it, i) => (i === idx ? { ...it, deviceId: d.id, imei: d.imei ?? imei, productId: d.productId } : it)));
  };

  const finalizar = async () => {
    if (!itens.length) return error('Adicione ao menos um produto.');
    if (!unitId) return error('Escolha a unidade.');
    try {
      await criar.mutateAsync({
        unitId,
        paymentMethod: pagamento,
        installments: Number(parcelas) || 1,
        customerName: cliente.name || null,
        customerPhone: cliente.phone || null,
        sellerName: vendedor || null,
        items: itens.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          deviceId: i.deviceId ?? null,
          imei: i.imei ?? null,
        })),
      });
      success('Venda registrada!');
      setItens([]);
      setCliente({ name: '', phone: '' });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro';
      if (msg === 'OFFLINE_QUEUED') {
        success('Sem internet: venda salva na fila.');
        onClose();
      } else error(msg);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova venda"
      size="lg"
      footer={
        <>
          <span className="mr-auto text-lg font-extrabold text-navy-900 dark:text-slate-100">{formatCurrency(total)}</span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="success" onClick={finalizar} loading={criar.isPending}>Finalizar venda</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Buscar produto por nome ou IMEI…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {resultados && resultados.data.length > 0 && busca.length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-card-hover dark:border-navy-700 dark:bg-navy-900">
              {resultados.data.map((p) => (
                <button
                  key={p.id}
                  onClick={() => adicionar(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-navy-800"
                >
                  <span className="min-w-0 truncate">
                    {p.name} <Badge tone={p.tipoControle === 'UNITARIO' ? 'info' : 'neutral'}>{p.tipoControle === 'UNITARIO' ? 'aparelho' : `${p.quantity} un.`}</Badge>
                  </span>
                  <span className="shrink-0 text-slate-400">{formatCurrency(p.salePrice || p.wholesalePrice || 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {itens.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Carrinho vazio. Busque um produto acima.</p>}
          {itens.map((it, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 p-2 dark:border-navy-700">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{it.nome}</span>
                <button onClick={() => setItens(itens.filter((_, i) => i !== idx))} className="text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {it.tipoControle === 'UNITARIO' ? (
                  <Input
                    className="sm:col-span-2"
                    placeholder="IMEI do aparelho"
                    defaultValue={it.imei ?? ''}
                    onBlur={(e) => e.target.value && trocarAparelho(idx, e.target.value)}
                  />
                ) : (
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x)))}
                  />
                )}
                <Input
                  type="number"
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))}
                />
                <span className="flex items-center justify-end text-sm font-semibold">{formatCurrency(it.unitPrice * it.quantity)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cliente">
            <Input value={cliente.name} onChange={(e) => setCliente({ ...cliente, name: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={cliente.phone} onChange={(e) => setCliente({ ...cliente, phone: e.target.value })} />
          </Field>
          <Field label="Vendedor">
            <Input value={vendedor} onChange={(e) => setVendedor(e.target.value)} placeholder="Nome de quem vendeu" />
          </Field>
          <Field label="Unidade">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} options={unidades.map((u) => ({ value: u.id, label: u.name }))} />
          </Field>
          <Field label="Forma de pagamento">
            <Select value={pagamento} onChange={(e) => setPagamento(e.target.value)} options={PAYMENT_OPTIONS} />
          </Field>
          {pagamento === 'CREDITO' && (
            <Field label="Parcelas">
              <Input type="number" min={1} max={24} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

export { Plus };
