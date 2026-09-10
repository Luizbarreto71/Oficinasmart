import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PhotoUploader } from '@/components/products/PhotoUploader';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAcaoDeOrdem, useUsers } from '@/hooks/queries';
import { ordemService } from '@/services';
import { pode } from '@/lib/permissoes';
import { useState } from 'react';

/** Itens do checklist de entrada — o que a bancada confere na hora. */
export const CHECKLIST_CAMPOS: { campo: string; rotulo: string }[] = [
  { campo: 'liga', rotulo: 'Liga / dá imagem' },
  { campo: 'tela', rotulo: 'Tela sem trinco' },
  { campo: 'touch', rotulo: 'Touch responde' },
  { campo: 'botoes', rotulo: 'Botões' },
  { campo: 'carga', rotulo: 'Carrega' },
  { campo: 'wifi', rotulo: 'Wi-Fi' },
  { campo: 'chip', rotulo: 'Chip / sinal' },
  { campo: 'cameraFrontal', rotulo: 'Câmera frontal' },
  { campo: 'cameraTraseira', rotulo: 'Câmera traseira' },
  { campo: 'campainha', rotulo: 'Alto-falante' },
  { campo: 'microfone', rotulo: 'Microfone' },
  { campo: 'biometria', rotulo: 'Biometria / Face' },
];

interface OrdemFormModalProps {
  open: boolean;
  onClose: () => void;
}

const VAZIO = {
  customerName: '',
  customerPhone: '',
  customerDocument: '',
  deviceBrand: '',
  deviceModel: '',
  deviceColor: '',
  deviceImei: '',
  deviceSerial: '',
  devicePassword: '',
  batteryHealth: '',
  accessories: '',
  conditionIn: '',
  reportedProblem: '',
  estimatedValue: '',
  technicianId: '',
  internalNotes: '',
};

export function OrdemFormModal({ open, onClose }: OrdemFormModalProps) {
  const { user } = useAuth();
  const { success, error } = useToast();
  const criar = useAcaoDeOrdem((data: Record<string, unknown>) => ordemService.criar(data));

  const podeVerUsuarios = pode(user?.role, 'usuarios');
  const { data: usuarios } = useUsers({ pageSize: 100 }, open && podeVerUsuarios);

  const [form, setForm] = useState({ ...VAZIO });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [fotos, setFotos] = useState<string[]>([]);

  const set = (campo: keyof typeof VAZIO, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  const limpar = () => {
    setForm({ ...VAZIO });
    setChecklist({});
    setFotos([]);
  };

  const salvar = async () => {
    if (!form.customerName.trim()) return error('Informe o nome do cliente.');
    if (!form.deviceModel.trim()) return error('Informe o aparelho.');
    if (form.reportedProblem.trim().length < 3) return error('Descreva o problema relatado.');

    try {
      const r = await criar.mutateAsync({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || null,
        customerDocument: form.customerDocument.trim() || null,
        deviceBrand: form.deviceBrand.trim() || null,
        deviceModel: form.deviceModel.trim(),
        deviceColor: form.deviceColor.trim() || null,
        deviceImei: form.deviceImei.trim() || null,
        deviceSerial: form.deviceSerial.trim() || null,
        devicePassword: form.devicePassword.trim() || null,
        batteryHealth: form.batteryHealth ? Number(form.batteryHealth) : null,
        accessories: form.accessories.trim() || null,
        conditionIn: form.conditionIn.trim() || null,
        checklistIn: Object.keys(checklist).length ? checklist : null,
        reportedProblem: form.reportedProblem.trim(),
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
        technicianId: form.technicianId || null,
        internalNotes: form.internalNotes.trim() || null,
        photos: fotos.map((data) => ({ tipo: 'ENTRADA', data })),
      });
      success((r.message as string) ?? 'OS aberta.');
      limpar();
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro ao abrir a OS.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova ordem de serviço"
      subtitle="Aparelho recebido para conserto"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={criar.isPending}>
            Abrir OS
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Cliente</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={form.customerName} onChange={(e) => set('customerName', e.target.value)} autoFocus />
            </Field>
            <Field label="Telefone">
              <Input value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
            </Field>
            <Field label="CPF/CNPJ">
              <Input value={form.customerDocument} onChange={(e) => set('customerDocument', e.target.value)} />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Aparelho</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Marca">
              <Input value={form.deviceBrand} onChange={(e) => set('deviceBrand', e.target.value)} placeholder="Apple, Samsung…" />
            </Field>
            <Field label="Modelo" required>
              <Input value={form.deviceModel} onChange={(e) => set('deviceModel', e.target.value)} placeholder="iPhone 12 64GB" />
            </Field>
            <Field label="Cor">
              <Input value={form.deviceColor} onChange={(e) => set('deviceColor', e.target.value)} />
            </Field>
            <Field label="Bateria (%)">
              <Input type="number" min={0} max={100} value={form.batteryHealth} onChange={(e) => set('batteryHealth', e.target.value)} />
            </Field>
            <Field label="IMEI">
              <Input value={form.deviceImei} onChange={(e) => set('deviceImei', e.target.value)} />
            </Field>
            <Field label="Nº de série">
              <Input value={form.deviceSerial} onChange={(e) => set('deviceSerial', e.target.value)} />
            </Field>
            <Field label="Senha / desenho" hint="A bancada precisa para testar">
              <Input value={form.devicePassword} onChange={(e) => set('devicePassword', e.target.value)} />
            </Field>
            <Field label="Acessórios que vieram junto">
              <Input value={form.accessories} onChange={(e) => set('accessories', e.target.value)} placeholder="Capa, chip, carregador…" />
            </Field>
            <Field label="Estado na entrada" className="sm:col-span-2">
              <Textarea
                value={form.conditionIn}
                onChange={(e) => set('conditionIn', e.target.value)}
                placeholder="Riscos, trincado, molhado, tampa solta…"
              />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Checklist de entrada</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CHECKLIST_CAMPOS.map(({ campo, rotulo }) => (
              <label key={campo} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-sm dark:border-navy-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                  checked={Boolean(checklist[campo])}
                  onChange={(e) => setChecklist((c) => ({ ...c, [campo]: e.target.checked }))}
                />
                <span className="truncate">{rotulo}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">Marque o que está funcionando na entrada.</p>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Atendimento</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Problema relatado pelo cliente" required className="sm:col-span-2">
              <Textarea value={form.reportedProblem} onChange={(e) => set('reportedProblem', e.target.value)} />
            </Field>
            <Field label="Estimativa inicial (R$)" hint="Opcional — só uma referência para o cliente">
              <Input type="number" step="0.01" value={form.estimatedValue} onChange={(e) => set('estimatedValue', e.target.value)} />
            </Field>
            {podeVerUsuarios && (
              <Field label="Técnico responsável">
                <Select
                  value={form.technicianId}
                  onChange={(e) => set('technicianId', e.target.value)}
                  placeholder="Definir depois"
                  options={(usuarios?.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
                />
              </Field>
            )}
            <Field label="Observações internas" hint="Não sai no comprovante do cliente" className="sm:col-span-2">
              <Textarea value={form.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <p className="label-base">Fotos do aparelho na entrada</p>
              <PhotoUploader photos={fotos} onChange={setFotos} max={8} />
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
