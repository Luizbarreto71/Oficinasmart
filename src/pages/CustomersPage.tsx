import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/contexts/ToastContext';
import { useCrudMutation, useCustomers } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { customerService } from '@/services';
import { formatPhone } from '@/lib/format';
import type { Customer } from '@/types';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function CustomersPage() {
  const { success, error } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 350);
  const { data, isLoading } = useCustomers(useMemo(() => ({ page, search: debounced || undefined }), [page, debounced]));

  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', document: '', notes: '' });

  const salvar = useCrudMutation(
    (v: { id?: string; data: Record<string, unknown> }) =>
      v.id ? customerService.update(v.id, v.data) : customerService.create(v.data),
    'customers',
    { onSuccess: () => { success('Cliente salvo.'); setAberto(false); } },
  );

  const abrir = (c?: Customer) => {
    setEditando(c ?? null);
    setForm({
      name: c?.name ?? '',
      phone: c?.phone ?? '',
      email: c?.email ?? '',
      document: c?.document ?? '',
      notes: c?.notes ?? '',
    });
    setAberto(true);
  };

  const columns: TableColumn<Customer>[] = [
    { key: 'name', header: 'Nome', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'phone', header: 'Telefone', render: (c) => formatPhone(c.phone) },
    { key: 'email', header: 'E-mail', hideOnMobile: true, render: (c) => c.email ?? '—' },
    { key: 'sales', header: 'Compras', align: 'right', hideOnMobile: true, render: (c) => c._count?.sales ?? 0 },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (c) => (
        <button onClick={() => abrir(c)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-accent dark:hover:bg-navy-800">
          <Pencil className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clientes"
        subtitle={data ? `${data.meta.total} cadastrados` : undefined}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => abrir()}>Novo cliente</Button>}
      />

      <Card className="p-3">
        <Input
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Card>

      <Card>
        <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} rowKey={(c) => c.id} emptyMessage="Nenhum cliente" />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
      </Card>

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title={editando ? 'Editar cliente' : 'Novo cliente'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              loading={salvar.isPending}
              onClick={() => {
                if (!form.name.trim()) return error('Informe o nome.');
                salvar.mutate({ id: editando?.id, data: form });
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Telefone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="CPF/CNPJ">
              <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            </Field>
          </div>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Observações">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
