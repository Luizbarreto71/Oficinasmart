import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { useTroca, useTrocas } from '@/hooks/queries';
import { ANATEL_URL, SITUACOES_IMEI } from '@shared/trocas';
import { formatCurrency, formatRelative } from '@/lib/format';
import type { Troca } from '@/types';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

const SIT_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  REGULAR: 'success',
  BLOQUEADO: 'danger',
  IRREGULAR: 'warning',
  NAO_CONSULTADO: 'neutral',
};

export default function TrocasPage() {
  const { success, error } = useToast();
  const { data } = useTrocas({});
  const criar = useTroca('criar');
  const anatel = useTroca('anatel');
  const recusar = useTroca('recusar');
  const excluir = useTroca('excluir');

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({
    modelo: '',
    marca: '',
    armazenamento: '',
    cor: '',
    imei: '',
    imeiSituacao: 'NAO_CONSULTADO',
    valorAvaliado: '',
    customerName: '',
    customerPhone: '',
    observacoes: '',
  });

  const salvar = async () => {
    if (!form.modelo.trim() || !form.customerName.trim() || !form.valorAvaliado)
      return error('Modelo, cliente e valor avaliado são obrigatórios.');
    try {
      const r = await criar.mutateAsync({ dados: { ...form, valorAvaliado: Number(form.valorAvaliado) } });
      success((r.message as string) ?? 'Troca registrada.');
      setAberto(false);
      setForm({ ...form, modelo: '', imei: '', valorAvaliado: '', observacoes: '' });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    }
  };

  const columns: TableColumn<Troca>[] = [
    { key: 'code', header: 'Código', render: (t) => t.code },
    { key: 'modelo', header: 'Aparelho', render: (t) => t.modelo },
    { key: 'cliente', header: 'Cliente', hideOnMobile: true, render: (t) => t.customerName },
    { key: 'imei', header: 'IMEI', hideOnMobile: true, render: (t) => <span className="font-mono text-xs">{t.imei || '—'}</span> },
    {
      key: 'anatel',
      header: 'Anatel',
      render: (t) => <Badge tone={SIT_TONE[t.imeiSituacao]}>{SITUACOES_IMEI.find((s) => s.chave === t.imeiSituacao)?.rotulo}</Badge>,
    },
    { key: 'valor', header: 'Avaliado', align: 'right', render: (t) => <strong>{formatCurrency(t.valorAvaliado)}</strong> },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <Badge tone={t.status === 'ACEITA' ? 'success' : t.status === 'RECUSADA' ? 'danger' : 'neutral'}>{t.status}</Badge>
      ),
    },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (t) =>
        t.status === 'AVALIADA' && (
          <div className="flex items-center justify-end gap-1">
            <Select
              className="h-8 w-28 text-xs"
              value={t.imeiSituacao}
              onChange={(e) =>
                anatel.mutate(
                  { id: t.id, dados: { imeiSituacao: e.target.value } },
                  { onSuccess: () => success('Situação registrada.'), onError: (er) => error(er.message) },
                )
              }
              options={SITUACOES_IMEI.map((s) => ({ value: s.chave, label: s.rotulo }))}
            />
            <button
              onClick={() => recusar.mutate({ id: t.id }, { onSuccess: (r) => success((r.message as string) ?? 'Recusada'), onError: (er) => error(er.message) })}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800"
              title="Recusar"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => excluir.mutate({ id: t.id }, { onSuccess: () => success('Excluída'), onError: (er) => error(er.message) })}
              className="rounded p-1.5 text-danger hover:bg-danger-bg"
              title="Excluir"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trocas"
        subtitle="Aparelhos usados recebidos como parte do pagamento"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAberto(true)}>Nova troca</Button>}
      />

      <Card>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={!data}
          rowKey={(t) => t.id}
          emptyMessage="Nenhuma troca registrada"
          mobileCard={(t) => (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.code} · {t.modelo}</p>
                <p className="text-xs text-slate-400">{t.customerName} · {formatRelative(t.createdAt)}</p>
              </div>
              <span className="shrink-0 font-semibold">{formatCurrency(t.valorAvaliado)}</span>
            </div>
          )}
        />
      </Card>

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title="Nova troca"
        size="lg"
        footer={
          <>
            <a href={ANATEL_URL} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-sm text-accent hover:underline">
              Consultar Anatel <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={salvar} loading={criar.isPending}>Registrar troca</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Modelo" required className="sm:col-span-2">
            <Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} placeholder="iPhone 11 64GB" autoFocus />
          </Field>
          <Field label="Marca">
            <Input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
          </Field>
          <Field label="Armazenamento">
            <Input value={form.armazenamento} onChange={(e) => setForm({ ...form, armazenamento: e.target.value })} />
          </Field>
          <Field label="Cor">
            <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
          </Field>
          <Field label="IMEI">
            <Input value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} />
          </Field>
          <Field label="Situação Anatel">
            <Select
              value={form.imeiSituacao}
              onChange={(e) => setForm({ ...form, imeiSituacao: e.target.value })}
              options={SITUACOES_IMEI.map((s) => ({ value: s.chave, label: s.rotulo }))}
            />
          </Field>
          <Field label="Valor avaliado (R$)" required>
            <Input type="number" step="0.01" value={form.valorAvaliado} onChange={(e) => setForm({ ...form, valorAvaliado: e.target.value })} />
          </Field>
          <Field label="Cliente" required>
            <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
