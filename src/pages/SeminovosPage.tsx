import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useSeminovos } from '@/hooks/queries';
import { seminovoService } from '@/services';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCurrency } from '@/lib/format';
import type { Product } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function SeminovosPage() {
  const { user } = useAuth();
  const { unidadeId, unidades } = useUnit();
  const { success, error } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 350);
  const { data, isLoading } = useSeminovos(useMemo(() => ({ search: debounced || undefined, unitId: unidadeId ?? undefined }), [debounced, unidadeId]));

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({
    modelo: '',
    marca: '',
    armazenamento: '',
    cor: '',
    imei: '',
    batteryHealth: '',
    valorPago: '',
    salePrice: '',
    unitId: unidadeId ?? '',
    vendedor: '',
    observacoes: '',
  });
  const [salvando, setSalvando] = useState(false);

  const comprar = async () => {
    if (!form.modelo.trim() || !form.valorPago || !form.unitId) return error('Modelo, valor pago e unidade são obrigatórios.');
    setSalvando(true);
    try {
      const r = await seminovoService.comprar({
        ...form,
        batteryHealth: form.batteryHealth ? Number(form.batteryHealth) : null,
        valorPago: Number(form.valorPago),
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
      });
      success(r.message);
      void qc.invalidateQueries({ queryKey: ['seminovos'] });
      setAberto(false);
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setSalvando(false);
    }
  };

  const columns: TableColumn<Product & { quantidade?: number; origem?: string }>[] = [
    {
      key: 'name',
      header: 'Aparelho',
      render: (p) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-bg text-warning">
            <Smartphone className="h-4 w-4" />
          </span>
          <div>
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-slate-400">{p.seminovoOrigem}</p>
          </div>
        </div>
      ),
    },
    { key: 'qtd', header: 'Em estoque', align: 'right', render: (p) => p.quantidade ?? p.quantity ?? 0 },
    { key: 'custo', header: 'Custo', align: 'right', hideOnMobile: true, render: (p) => formatCurrency(p.costPrice) },
    { key: 'venda', header: 'Venda', align: 'right', render: (p) => formatCurrency(p.salePrice || 0) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seminovos"
        subtitle="Aparelhos usados recebidos em troca ou comprados"
        actions={
          user?.role !== 'CAIXA' && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAberto(true)}>
              Comprar seminovo
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Peças em estoque" value={data?.resumo.pecas ?? 0} />
        <StatCard label="Investido" value={formatCurrency(data?.resumo.investido ?? 0)} tone="warning" />
      </div>

      <Card className="p-3">
        <Input placeholder="Buscar por modelo, IMEI ou origem…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>

      <Card>
        <DataTable columns={columns} data={(data?.data as never) ?? []} loading={isLoading} rowKey={(p) => p.id} emptyMessage="Nenhum seminovo" />
      </Card>

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title="Comprar seminovo"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={comprar} loading={salvando}>Cadastrar</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Modelo" required className="sm:col-span-2">
            <Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} placeholder="iPhone 12" autoFocus />
          </Field>
          <Field label="Marca">
            <Input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
          </Field>
          <Field label="Armazenamento">
            <Input value={form.armazenamento} onChange={(e) => setForm({ ...form, armazenamento: e.target.value })} placeholder="128GB" />
          </Field>
          <Field label="Cor">
            <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
          </Field>
          <Field label="IMEI">
            <Input value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} />
          </Field>
          <Field label="Saúde da bateria (%)">
            <Input type="number" value={form.batteryHealth} onChange={(e) => setForm({ ...form, batteryHealth: e.target.value })} />
          </Field>
          <Field label="Valor pago (R$)" required>
            <Input type="number" step="0.01" value={form.valorPago} onChange={(e) => setForm({ ...form, valorPago: e.target.value })} />
          </Field>
          <Field label="Preço de venda (R$)">
            <Input type="number" step="0.01" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
          </Field>
          <Field label="Unidade" required>
            <Select
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="Selecione…"
              options={unidades.map((u) => ({ value: u.id, label: u.name }))}
            />
          </Field>
          <Field label="Comprado de">
            <Input value={form.vendedor} onChange={(e) => setForm({ ...form, vendedor: e.target.value })} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
