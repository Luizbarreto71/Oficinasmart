import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useCriarPreVenda, useDesistirPreVenda, usePreVendas } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { productService } from '@/services';
import { PRE_SALE_LABEL, formatCurrency, formatRelative } from '@/lib/format';
import type { Product } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

interface Linha {
  productId: string;
  nome: string;
  quantity: number;
  unitPrice: number;
}

export default function PreSalePage() {
  const { success, error } = useToast();
  const { unidadeId } = useUnit();
  const { data: lista } = usePreVendas({});
  const criar = useCriarPreVenda();
  const desistir = useDesistirPreVenda();

  const [aberto, setAberto] = useState(false);
  const [cliente, setCliente] = useState({ name: '', phone: '' });
  const [itens, setItens] = useState<Linha[]>([]);
  const [busca, setBusca] = useState('');
  const debounced = useDebounce(busca, 300);

  const { data: resultados } = useQuery({
    queryKey: ['pv-busca', debounced],
    queryFn: () => productService.list({ search: debounced, pageSize: 10, status: 'EM_ESTOQUE' }),
    enabled: aberto && debounced.length >= 2,
  });

  const total = useMemo(() => itens.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [itens]);

  const enviar = async () => {
    if (!cliente.name.trim()) return error('Informe o nome do cliente.');
    if (!itens.length) return error('Adicione ao menos um produto.');
    try {
      const r = await criar.mutateAsync({
        customerName: cliente.name,
        customerPhone: cliente.phone || null,
        unitId: unidadeId ?? null,
        items: itens.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
      });
      success((r as { message?: string }).message ?? 'Pré-venda enviada ao caixa.');
      setAberto(false);
      setItens([]);
      setCliente({ name: '', phone: '' });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pré-vendas"
        subtitle="Monte o pedido; o caixa cobra e finaliza"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAberto(true)}>Nova pré-venda</Button>}
      />

      <Card>
        <CardHeader title="Minhas pré-vendas" />
        <CardBody className="space-y-2">
          {!lista?.data.length && <p className="text-sm text-slate-500">Nenhuma pré-venda.</p>}
          {lista?.data.map((pv) => (
            <div key={pv.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-navy-700">
              <div className="min-w-0">
                <p className="font-semibold">
                  {pv.code} · {pv.customerName}{' '}
                  <Badge tone={pv.status === 'FINALIZADA' ? 'success' : pv.status === 'CANCELADA' ? 'danger' : 'warning'}>
                    {PRE_SALE_LABEL[pv.status]}
                  </Badge>
                </p>
                <p className="text-xs text-slate-400">
                  {formatCurrency(pv.totalAmount)} · {formatRelative(pv.createdAt)}
                </p>
              </div>
              {pv.status === 'AGUARDANDO_CAIXA' && (
                <button
                  onClick={() => desistir.mutate(pv.id, { onSuccess: (r) => success(r.message), onError: (e) => error(e.message) })}
                  className="rounded p-1.5 text-danger hover:bg-danger-bg"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title="Nova pré-venda"
        size="lg"
        footer={
          <>
            <span className="mr-auto text-lg font-bold">{formatCurrency(total)}</span>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={enviar} loading={criar.isPending}>Enviar ao caixa</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cliente" required>
              <Input value={cliente.name} onChange={(e) => setCliente({ ...cliente, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Telefone">
              <Input value={cliente.phone} onChange={(e) => setCliente({ ...cliente, phone: e.target.value })} />
            </Field>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {resultados && resultados.data.length > 0 && busca.length >= 2 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-card-hover dark:border-navy-700 dark:bg-navy-900">
                {resultados.data.map((p: Product) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setItens((v) => [...v, { productId: p.id, nome: p.name, quantity: 1, unitPrice: Number(p.salePrice || p.wholesalePrice || 0) }]);
                      setBusca('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-slate-400">{formatCurrency(p.salePrice || p.wholesalePrice || 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {itens.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-navy-700">
                <span className="min-w-0 flex-1 truncate text-sm">{it.nome}</span>
                <Input
                  className="w-16"
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x)))}
                />
                <Input
                  className="w-24"
                  type="number"
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))}
                />
                <button onClick={() => setItens(itens.filter((_, i) => i !== idx))} className="text-danger">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
