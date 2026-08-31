import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import {
  useActivityLogs,
  useCategories,
  useCrudMutation,
  useSuppliers,
  useUnits,
  useUsers,
} from '@/hooks/queries';
import { categoryService, importService, settingsService, supplierService, unitService, userService } from '@/services';
import { downloadFile } from '@/lib/api';
import { ROLE_LABEL, formatDateTime } from '@/lib/format';
import type { AuditLog, Category, Supplier, Unit, User } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { Download, Pencil, Plus, Upload } from 'lucide-react';
import { useState } from 'react';

type Aba = 'categorias' | 'fornecedores' | 'usuarios' | 'unidades' | 'sistema' | 'logs';

const ABAS: { key: Aba; label: string }[] = [
  { key: 'categorias', label: 'Categorias' },
  { key: 'fornecedores', label: 'Fornecedores' },
  { key: 'usuarios', label: 'Usuários' },
  { key: 'unidades', label: 'Unidades' },
  { key: 'sistema', label: 'Sistema' },
  { key: 'logs', label: 'Auditoria' },
];

export default function SettingsPage() {
  const [aba, setAba] = useState<Aba>('categorias');

  return (
    <div className="space-y-4">
      <PageHeader title="Configurações" />

      <Card>
        <div className="flex overflow-x-auto border-b border-slate-200 dark:border-navy-700">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                'shrink-0 px-4 py-2.5 text-sm font-semibold transition',
                aba === a.key ? 'border-b-2 border-accent text-accent' : 'text-slate-500 hover:text-navy-900 dark:hover:text-slate-100',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <CardBody>
          {aba === 'categorias' && <Categorias />}
          {aba === 'fornecedores' && <Fornecedores />}
          {aba === 'usuarios' && <Usuarios />}
          {aba === 'unidades' && <Unidades />}
          {aba === 'sistema' && <Sistema />}
          {aba === 'logs' && <Logs />}
        </CardBody>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Categorias

function Categorias() {
  const { success, error } = useToast();
  const { data } = useCategories();
  const [aberto, setAberto] = useState(false);
  const [edit, setEdit] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', tipoControlePadrao: 'QUANTIDADE', ordem: '0' });

  const salvar = useCrudMutation(
    (v: { id?: string; data: Record<string, unknown> }) => (v.id ? categoryService.update(v.id, v.data) : categoryService.create(v.data)),
    'categories',
    { onSuccess: () => { success('Categoria salva.'); setAberto(false); } },
  );
  const remover = useCrudMutation((id: string) => categoryService.remove(id), 'categories', {
    onSuccess: () => success('Categoria excluída.'),
    onError: (e) => error(e.message),
  });

  const cols: TableColumn<Category>[] = [
    { key: 'name', header: 'Nome', render: (c) => <span className={c.ehSubcategoria ? 'pl-4 text-slate-500' : 'font-medium'}>{c.caminho ?? c.name}</span> },
    { key: 'tipo', header: 'Tipo padrão', render: (c) => <Badge tone={c.tipoControlePadrao === 'UNITARIO' ? 'info' : 'neutral'}>{c.tipoControlePadrao === 'UNITARIO' ? 'Aparelho' : 'Quantidade'}</Badge> },
    { key: 'produtos', header: 'Produtos', align: 'right', render: (c) => c._count?.products ?? 0 },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => { setEdit(c); setForm({ name: c.name, tipoControlePadrao: c.tipoControlePadrao ?? 'QUANTIDADE', ordem: String(c.ordem ?? 0) }); setAberto(true); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800">
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setForm({ name: '', tipoControlePadrao: 'QUANTIDADE', ordem: '0' }); setAberto(true); }}>
          Nova categoria
        </Button>
      </div>
      <DataTable columns={cols} data={data ?? []} loading={!data} rowKey={(c) => c.id} />

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title={edit ? 'Editar categoria' : 'Nova categoria'}
        footer={
          <>
            {edit && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => remover.mutate(edit.id)}>
                Excluir
              </Button>
            )}
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button loading={salvar.isPending} onClick={() => salvar.mutate({ id: edit?.id, data: { ...form, ordem: Number(form.ordem) } })}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Tipo de controle padrão" hint="Sugestão ao cadastrar um produto nesta categoria">
            <Select
              value={form.tipoControlePadrao}
              onChange={(e) => setForm({ ...form, tipoControlePadrao: e.target.value })}
              options={[
                { value: 'QUANTIDADE', label: 'Por quantidade' },
                { value: 'UNITARIO', label: 'Por aparelho (IMEI)' },
              ]}
            />
          </Field>
          <Field label="Ordem">
            <Input type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Fornecedores

function Fornecedores() {
  const { success } = useToast();
  const { data } = useSuppliers({ pageSize: 100 });
  const [aberto, setAberto] = useState(false);
  const [edit, setEdit] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', document: '' });

  const salvar = useCrudMutation(
    (v: { id?: string; data: Record<string, unknown> }) => (v.id ? supplierService.update(v.id, v.data) : supplierService.create(v.data)),
    'suppliers',
    { onSuccess: () => { success('Fornecedor salvo.'); setAberto(false); } },
  );

  const cols: TableColumn<Supplier>[] = [
    { key: 'name', header: 'Nome', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'phone', header: 'Telefone', render: (s) => s.phone ?? '—' },
    { key: 'produtos', header: 'Produtos', align: 'right', render: (s) => s._count?.products ?? 0 },
    { key: 'ativo', header: 'Ativo', render: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Sim' : 'Não'}</Badge> },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (s) => (
        <button onClick={() => { setEdit(s); setForm({ name: s.name, phone: s.phone ?? '', email: s.email ?? '', document: s.document ?? '' }); setAberto(true); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800">
          <Pencil className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setForm({ name: '', phone: '', email: '', document: '' }); setAberto(true); }}>
          Novo fornecedor
        </Button>
      </div>
      <DataTable columns={cols} data={data?.data ?? []} loading={!data} rowKey={(s) => s.id} />

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title={edit ? 'Editar fornecedor' : 'Novo fornecedor'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button loading={salvar.isPending} onClick={() => salvar.mutate({ id: edit?.id, data: form })}>Salvar</Button>
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
            <Field label="Documento">
              <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            </Field>
          </div>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------------- Usuários

function Usuarios() {
  const { success } = useToast();
  const { data } = useUsers({ pageSize: 100 });
  const { data: unidades } = useUnits();
  const [aberto, setAberto] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'VENDEDOR', unitId: '' });

  const salvar = useCrudMutation(
    (v: { id?: string; data: Record<string, unknown> }) => (v.id ? userService.update(v.id, v.data) : userService.create(v.data)),
    'users',
    { onSuccess: () => { success('Usuário salvo.'); setAberto(false); } },
  );

  const cols: TableColumn<User>[] = [
    { key: 'name', header: 'Nome', render: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'email', header: 'E-mail', render: (u) => u.email },
    { key: 'role', header: 'Perfil', render: (u) => <Badge>{ROLE_LABEL[u.role]}</Badge> },
    { key: 'unit', header: 'Unidade', hideOnMobile: true, render: (u) => u.unit?.name ?? '—' },
    { key: 'ativo', header: 'Ativo', render: (u) => <Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Sim' : 'Não'}</Badge> },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (u) => (
        <button onClick={() => { setEdit(u); setForm({ name: u.name, email: u.email, password: '', role: u.role, unitId: u.unitId ?? '' }); setAberto(true); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800">
          <Pencil className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setForm({ name: '', email: '', password: '', role: 'VENDEDOR', unitId: '' }); setAberto(true); }}>
          Novo usuário
        </Button>
      </div>
      <DataTable columns={cols} data={data?.data ?? []} loading={!data} rowKey={(u) => u.id} />

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title={edit ? 'Editar usuário' : 'Novo usuário'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              loading={salvar.isPending}
              onClick={() => {
                const data: Record<string, unknown> = { name: form.name, email: form.email, role: form.role, unitId: form.unitId || null };
                if (form.password) data.password = form.password;
                salvar.mutate({ id: edit?.id, data });
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
          <Field label="E-mail" required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={edit ? 'Nova senha (deixe em branco para manter)' : 'Senha'}>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Perfil">
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Unidade" hint="Vazio = todas (admin)">
              <Select
                value={form.unitId}
                onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                placeholder="Todas"
                options={(unidades ?? []).map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------------- Unidades

function Unidades() {
  const { success } = useToast();
  const { data } = useUnits();
  const [aberto, setAberto] = useState(false);
  const [edit, setEdit] = useState<Unit | null>(null);
  const [form, setForm] = useState({ name: '', type: 'FILIAL' });

  const salvar = useCrudMutation(
    (v: { id?: string; data: Record<string, unknown> }) => (v.id ? unitService.update(v.id, v.data) : unitService.create(v.data)),
    'units',
    { onSuccess: () => { success('Unidade salva.'); setAberto(false); } },
  );

  const cols: TableColumn<Unit>[] = [
    { key: 'name', header: 'Nome', render: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'type', header: 'Tipo', render: (u) => <Badge>{u.type}</Badge> },
    { key: 'ativo', header: 'Ativa', render: (u) => <Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Sim' : 'Não'}</Badge> },
    {
      key: 'acoes',
      header: '',
      align: 'right',
      render: (u) => (
        <button onClick={() => { setEdit(u); setForm({ name: u.name, type: u.type }); setAberto(true); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800">
          <Pencil className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setForm({ name: '', type: 'FILIAL' }); setAberto(true); }}>
          Nova unidade
        </Button>
      </div>
      <DataTable columns={cols} data={data ?? []} loading={!data} rowKey={(u) => u.id} />

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title={edit ? 'Editar unidade' : 'Nova unidade'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button loading={salvar.isPending} onClick={() => salvar.mutate({ id: edit?.id, data: form })}>Salvar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Tipo">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              options={[
                { value: 'MATRIZ', label: 'Matriz' },
                { value: 'FILIAL', label: 'Filial / depósito' },
              ]}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// --------------------------------------------------------------------- Sistema

function Sistema() {
  const { success, error } = useToast();
  const qc = useQueryClient();
  const [senha, setSenha] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [meta, setMeta] = useState('');
  const [chave, setChave] = useState('');
  const [importando, setImportando] = useState(false);

  const trocarSenha = async () => {
    try {
      const r = await settingsService.changePassword(senha);
      success(r.message);
      setSenha({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    }
  };

  const importar = async (file?: File) => {
    if (!file) return;
    setImportando(true);
    try {
      const r = await importService.products(file);
      success(r.message + (r.errors.length ? ` — ${r.errors.length} linha(s) com erro` : ''));
      void qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Alterar minha senha" />
        <CardBody className="space-y-3">
          <Field label="Senha atual">
            <Input type="password" value={senha.currentPassword} onChange={(e) => setSenha({ ...senha, currentPassword: e.target.value })} />
          </Field>
          <Field label="Nova senha">
            <Input type="password" value={senha.newPassword} onChange={(e) => setSenha({ ...senha, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={senha.confirmPassword} onChange={(e) => setSenha({ ...senha, confirmPassword: e.target.value })} />
          </Field>
          <Button onClick={trocarSenha}>Trocar senha</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Meta de vendas" subtitle="Aparelhos por dia, por vendedor" />
        <CardBody className="space-y-3">
          <Field label="Meta diária">
            <Input type="number" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="10" />
          </Field>
          <Button
            onClick={() =>
              settingsService
                .salvarMeta(Number(meta) || 10)
                .then((r) => success(r.message))
                .catch((e) => error(e instanceof Error ? e.message : 'Erro'))
            }
          >
            Salvar meta
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Chave de acesso" subtitle="Libera vender abaixo do preço de atacado" />
        <CardBody className="space-y-3">
          <Field label="Nova chave">
            <Input value={chave} onChange={(e) => setChave(e.target.value)} placeholder="mínimo 4 caracteres" />
          </Field>
          <Button
            onClick={() =>
              settingsService
                .salvarChave(chave)
                .then((r) => {
                  success(r.message);
                  setChave('');
                })
                .catch((e) => error(e instanceof Error ? e.message : 'Erro'))
            }
          >
            Salvar chave
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Planilha de produtos" />
        <CardBody className="space-y-3">
          <Button
            variant="outline"
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadFile('/settings/import/template', {}, 'modelo-produtos.xlsx')}
          >
            Baixar modelo
          </Button>
          <label>
            <span className="sr-only">Importar</span>
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => importar(e.target.files?.[0])} id="import-file" />
            <Button
              icon={<Upload className="h-4 w-4" />}
              loading={importando}
              onClick={() => document.getElementById('import-file')?.click()}
            >
              Importar produtos
            </Button>
          </label>
          <Button
            variant="ghost"
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadFile('/settings/backup', {}, 'backup.json')}
          >
            Backup completo (JSON)
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------- Logs

function Logs() {
  const [page, setPage] = useState(1);
  const { data } = useActivityLogs({ page });

  const cols: TableColumn<AuditLog>[] = [
    { key: 'date', header: 'Data', render: (l) => <span className="text-xs">{formatDateTime(l.createdAt)}</span> },
    { key: 'user', header: 'Usuário', render: (l) => l.user?.name ?? '—' },
    { key: 'action', header: 'Ação', render: (l) => <Badge>{l.action}</Badge> },
    { key: 'entity', header: 'Entidade', render: (l) => l.entity },
  ];

  return (
    <div className="space-y-2">
      <DataTable columns={cols} data={data?.data ?? []} loading={!data} rowKey={(l) => l.id} />
      {data && data.meta.totalPages > 1 && (
        <div className="flex justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button size="sm" variant="ghost" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
