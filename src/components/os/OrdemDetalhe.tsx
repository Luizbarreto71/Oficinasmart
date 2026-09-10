import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useOrdem, useAcaoDeOrdem, useProducts } from '@/hooks/queries';
import { openPdf } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, PAYMENT_OPTIONS } from '@/lib/format';
import { pode } from '@/lib/permissoes';
import { ordemService } from '@/services';
import type { ServiceOrder, ServiceOrderItem } from '@/types';
import { CheckCircle2, Circle, Printer, Wrench, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CHECKLIST_CAMPOS } from './OrdemFormModal';

const PASSOS: { status: ServiceOrder['status']; rotulo: string }[] = [
  { status: 'RECEBIDO', rotulo: 'Recebido' },
  { status: 'EM_ANALISE', rotulo: 'Análise' },
  { status: 'ORCAMENTO', rotulo: 'Orçamento' },
  { status: 'APROVADO', rotulo: 'Aprovado' },
  { status: 'EM_REPARO', rotulo: 'Reparo' },
  { status: 'PRONTO', rotulo: 'Pronto' },
  { status: 'ENTREGUE', rotulo: 'Entregue' },
];

const ROTULO_CHECKLIST = Object.fromEntries(CHECKLIST_CAMPOS.map((c) => [c.campo, c.rotulo]));

/** Onde cada status cai no stepper (AGUARDANDO_PECA divide a etapa "Reparo"). */
const STATUS_PASSO: Record<string, number> = {
  RECEBIDO: 0,
  EM_ANALISE: 1,
  ORCAMENTO: 2,
  APROVADO: 3,
  EM_REPARO: 4,
  AGUARDANDO_PECA: 4,
  PRONTO: 5,
  ENTREGUE: 6,
};

const valorSim = (v: unknown) => {
  if (v === true || v === 'sim' || v === 'ok') return 'Sim';
  if (v === false || v === 'nao' || v === 'não') return 'Não';
  return v == null || v === '' ? '—' : String(v);
};

interface Props {
  ordemId: string;
  onClose: () => void;
}

export function OrdemDetalhe({ ordemId, onClose }: Props) {
  const { user } = useAuth();
  const { success, error } = useToast();
  const { data: os, isLoading } = useOrdem(ordemId);

  const acao = useAcaoDeOrdem((fn: () => Promise<unknown>) => fn());

  const [orcando, setOrcando] = useState(false);
  const [entregando, setEntregando] = useState(false);

  const podeOrcar = pode(user?.role, 'os.orcar');
  const podeEditar = pode(user?.role, 'os.editar');
  const podeEntregar = pode(user?.role, 'os.entregar');

  const rodar = (fn: () => Promise<{ message?: string } | unknown>) =>
    acao.mutate(fn as () => Promise<unknown>, {
      onSuccess: (r) => success((r?.message as string) ?? 'Feito.'),
      onError: (e) => error(e.message),
    });

  const finalizado = !!os && ['ENTREGUE', 'CANCELADO', 'RECUSADO'].includes(os.status);
  const passoAtual = os ? STATUS_PASSO[os.status] ?? -1 : -1;

  return (
    <>
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={os ? `OS ${os.code}` : 'Ordem de serviço'}
      subtitle={os ? `${[os.deviceBrand, os.deviceModel].filter(Boolean).join(' ')} · ${os.customerName}` : undefined}
      footer={
        <>
          {os && (
            <Button variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(ordemService.comprovanteUrl(os.id))}>
              Comprovante
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {isLoading || !os ? (
        <div className="py-16 text-center text-sm text-slate-500">Carregando…</div>
      ) : (
        <div className="space-y-5">
          {/* Stepper */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {PASSOS.map((p, i) => {
              const feito = passoAtual >= 0 && i <= passoAtual && !['RECUSADO', 'CANCELADO'].includes(os.status);
              return (
                <div key={p.status} className="flex shrink-0 items-center">
                  <div className="flex flex-col items-center gap-1">
                    {feito ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 text-slate-300 dark:text-navy-600" />
                    )}
                    <span className={`text-[10px] ${feito ? 'font-semibold text-navy-800 dark:text-slate-200' : 'text-slate-400'}`}>
                      {p.rotulo}
                    </span>
                  </div>
                  {i < PASSOS.length - 1 && <div className={`mx-1 h-0.5 w-8 ${feito ? 'bg-success' : 'bg-slate-200 dark:bg-navy-700'}`} />}
                </div>
              );
            })}
            {['RECUSADO', 'CANCELADO'].includes(os.status) && (
              <Badge tone="danger" className="ml-2">
                {os.statusLabel}
              </Badge>
            )}
          </div>

          {/* Ações */}
          {!finalizado && (
            <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-3 dark:bg-navy-800/50">
              {os.status === 'RECEBIDO' && podeEditar && (
                <Button size="sm" variant="outline" onClick={() => rodar(() => ordemService.status(os.id, 'EM_ANALISE'))}>
                  Iniciar análise
                </Button>
              )}
              {['RECEBIDO', 'EM_ANALISE', 'ORCAMENTO', 'AGUARDANDO_PECA'].includes(os.status) && podeOrcar && (
                <Button size="sm" onClick={() => setOrcando(true)}>
                  {os.items.length ? 'Revisar orçamento' : 'Montar orçamento'}
                </Button>
              )}
              {os.status === 'ORCAMENTO' && podeOrcar && (
                <>
                  <Button size="sm" variant="success" onClick={() => rodar(() => ordemService.aprovar(os.id))}>
                    Cliente aprovou
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      const motivo = window.prompt('Motivo da recusa (opcional):') ?? undefined;
                      rodar(() => ordemService.recusar(os.id, motivo || undefined));
                    }}
                  >
                    Cliente recusou
                  </Button>
                </>
              )}
              {['APROVADO', 'AGUARDANDO_PECA'].includes(os.status) && podeEditar && (
                <Button size="sm" variant="outline" onClick={() => rodar(() => ordemService.status(os.id, 'EM_REPARO'))}>
                  Em reparo
                </Button>
              )}
              {os.status === 'EM_REPARO' && podeEditar && (
                <Button size="sm" variant="outline" onClick={() => rodar(() => ordemService.status(os.id, 'AGUARDANDO_PECA'))}>
                  Aguardando peça
                </Button>
              )}
              {['APROVADO', 'EM_REPARO', 'AGUARDANDO_PECA'].includes(os.status) && podeEditar && (
                <Button size="sm" variant="outline" onClick={() => rodar(() => ordemService.status(os.id, 'PRONTO'))}>
                  Marcar pronto
                </Button>
              )}
              {['APROVADO', 'EM_REPARO', 'AGUARDANDO_PECA', 'PRONTO'].includes(os.status) && podeEntregar && (
                <Button size="sm" variant="success" icon={<Wrench className="h-4 w-4" />} onClick={() => setEntregando(true)}>
                  Entregar e cobrar
                </Button>
              )}
              {podeEditar && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => {
                    if (!window.confirm(`Cancelar a OS ${os.code}? O aparelho volta para o cliente.`)) return;
                    const motivo = window.prompt('Motivo do cancelamento (opcional):') ?? undefined;
                    rodar(() => ordemService.cancelar(os.id, motivo || undefined));
                  }}
                >
                  Cancelar OS
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Bloco titulo="Cliente">
              <Linha rotulo="Nome" valor={os.customerName} />
              <Linha rotulo="Telefone" valor={os.customerPhone} />
              <Linha rotulo="CPF/CNPJ" valor={os.customerDocument} />
              <Linha rotulo="Entrada" valor={formatDateTime(os.createdAt)} />
              {os.technician && <Linha rotulo="Técnico" valor={os.technician.name} />}
              {os.unit && <Linha rotulo="Loja" valor={os.unit.name} />}
            </Bloco>

            <Bloco titulo="Aparelho">
              <Linha rotulo="Modelo" valor={[os.deviceBrand, os.deviceModel, os.deviceColor].filter(Boolean).join(' ')} />
              <Linha rotulo="IMEI" valor={os.deviceImei} mono />
              <Linha rotulo="Nº série" valor={os.deviceSerial} mono />
              <Linha rotulo="Senha" valor={os.devicePassword} mono />
              <Linha rotulo="Bateria" valor={os.batteryHealth != null ? `${os.batteryHealth}%` : null} />
              <Linha rotulo="Acessórios" valor={os.accessories} />
            </Bloco>
          </div>

          {os.conditionIn && (
            <Bloco titulo="Estado na entrada">
              <p className="text-sm text-navy-800 dark:text-slate-200">{os.conditionIn}</p>
            </Bloco>
          )}

          {os.checklistIn && Object.keys(os.checklistIn).length > 0 && (
            <Bloco titulo="Checklist de entrada">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {Object.entries(os.checklistIn).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-500">{ROTULO_CHECKLIST[k] ?? k}</span>
                    <span className="shrink-0 font-medium">{valorSim(v)}</span>
                  </div>
                ))}
              </div>
            </Bloco>
          )}

          <Bloco titulo="Problema e laudo">
            <Linha rotulo="Relatado" valor={os.reportedProblem} />
            <Linha rotulo="Laudo técnico" valor={os.diagnosis} />
            {podeEditar && !finalizado && (
              <button
                className="mt-1 text-xs font-medium text-accent hover:underline"
                onClick={async () => {
                  const laudo = window.prompt('Laudo técnico:', os.diagnosis ?? '');
                  if (laudo === null) return;
                  rodar(() => ordemService.editar(os.id, { diagnosis: laudo }));
                }}
              >
                Editar laudo
              </button>
            )}
          </Bloco>

          {/* Orçamento */}
          <Bloco titulo={os.status === 'ENTREGUE' ? 'Serviço realizado' : 'Orçamento'}>
            {os.items.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum item no orçamento ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="py-1">Descrição</th>
                      <th className="py-1">Tipo</th>
                      <th className="py-1 text-right">Qtd</th>
                      <th className="py-1 text-right">Unit.</th>
                      <th className="py-1 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {os.items.map((it) => (
                      <tr key={it.id} className="border-t border-slate-100 dark:border-navy-700">
                        <td className="py-1.5">{it.description}</td>
                        <td className="py-1.5 text-slate-500">{it.kind === 'PECA' ? 'Peça' : 'Serviço'}</td>
                        <td className="py-1.5 text-right">{it.quantity}</td>
                        <td className="py-1.5 text-right">{formatCurrency(it.unitPrice)}</td>
                        <td className="py-1.5 text-right font-medium">{formatCurrency(it.unitPrice * it.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {os.discount > 0 && (
                      <tr className="text-slate-500">
                        <td colSpan={4} className="py-1 text-right">
                          Desconto
                        </td>
                        <td className="py-1 text-right">- {formatCurrency(os.discount)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-200 font-bold dark:border-navy-600">
                      <td colSpan={4} className="py-1.5 text-right">
                        Total
                      </td>
                      <td className="py-1.5 text-right">
                        {formatCurrency(os.status === 'ENTREGUE' ? os.totalAmount : (os.quotedValue ?? 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {os.warrantyDays ? (
              <p className="mt-2 text-xs text-slate-500">
                Garantia do serviço: {os.warrantyDays} dias
                {os.warrantyUntil ? ` · até ${formatDate(os.warrantyUntil)}` : ''}
              </p>
            ) : null}
            {os.sale && (
              <p className="mt-1 text-xs text-slate-500">
                Venda gerada: <span className="font-semibold">{os.sale.code}</span> · {formatCurrency(os.sale.totalAmount)}
              </p>
            )}
          </Bloco>

          {os.photos.length > 0 && (
            <Bloco titulo="Fotos">
              <div className="flex flex-wrap gap-2">
                {os.photos.map((f) => (
                  <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="relative">
                    <img src={f.url} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover dark:border-navy-700" />
                    <span className="absolute left-1 top-1 rounded bg-navy-900/70 px-1 text-[9px] font-semibold text-white">
                      {f.tipo}
                    </span>
                  </a>
                ))}
              </div>
            </Bloco>
          )}
        </div>
      )}
    </Modal>

    {os && orcando && <OrcamentoModal os={os} onClose={() => setOrcando(false)} />}
    {os && entregando && <EntregaModal os={os} onClose={() => setEntregando(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ Blocos

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{titulo}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-slate-500">{rotulo}</span>
      <span className={`min-w-0 text-right text-navy-800 dark:text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>
        {valor || '—'}
      </span>
    </div>
  );
}

// -------------------------------------------------------------- Orçamento

interface LinhaOrcamento {
  kind: 'PECA' | 'SERVICO';
  description: string;
  quantity: number;
  unitPrice: number;
  productId?: string | null;
}

function OrcamentoModal({ os, onClose }: { os: ServiceOrder; onClose: () => void }) {
  const { success, error } = useToast();
  const salvar = useAcaoDeOrdem((data: Record<string, unknown>) => ordemService.orcar(os.id, data));

  const [itens, setItens] = useState<LinhaOrcamento[]>(
    os.items.length
      ? os.items.map((i: ServiceOrderItem) => ({
          kind: i.kind,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          productId: i.productId ?? null,
        }))
      : [{ kind: 'SERVICO', description: '', quantity: 1, unitPrice: 0 }],
  );
  const [warrantyDays, setWarrantyDays] = useState(String(os.warrantyDays ?? 90));
  const [discount, setDiscount] = useState(String(os.discount || ''));
  const [busca, setBusca] = useState('');

  const { data: produtos } = useProducts({ search: busca, pageSize: 8 });

  const total = useMemo(
    () => Math.max(0, itens.reduce((s, i) => s + i.unitPrice * i.quantity, 0) - (Number(discount) || 0)),
    [itens, discount],
  );

  const setLinha = (idx: number, patch: Partial<LinhaOrcamento>) =>
    setItens((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const enviar = async () => {
    const limpos = itens.filter((i) => i.description.trim() && i.quantity > 0);
    if (!limpos.length) return error('Adicione ao menos um item ao orçamento.');
    try {
      const r = await salvar.mutateAsync({
        items: limpos.map((i) => ({
          kind: i.kind,
          description: i.description.trim(),
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          productId: i.productId ?? null,
        })),
        warrantyDays: warrantyDays ? Number(warrantyDays) : null,
        discount: Number(discount) || 0,
      });
      success((r.message as string) ?? 'Orçamento salvo.');
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro ao salvar o orçamento.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Orçamento — OS ${os.code}`}
      subtitle="Peças do estoque e mão de obra"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={enviar} loading={salvar.isPending}>
            Salvar e enviar ao cliente
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {itens.map((linha, idx) => (
            <div key={idx} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-12 sm:col-span-5">
                {idx === 0 && <p className="label-base">Descrição</p>}
                <Input value={linha.description} onChange={(e) => setLinha(idx, { description: e.target.value })} placeholder="Troca de tela, bateria…" />
              </div>
              <div className="col-span-4 sm:col-span-2">
                {idx === 0 && <p className="label-base">Tipo</p>}
                <Select
                  value={linha.kind}
                  onChange={(e) => setLinha(idx, { kind: e.target.value as 'PECA' | 'SERVICO' })}
                  options={[
                    { value: 'SERVICO', label: 'Serviço' },
                    { value: 'PECA', label: 'Peça' },
                  ]}
                />
              </div>
              <div className="col-span-3 sm:col-span-1">
                {idx === 0 && <p className="label-base">Qtd</p>}
                <Input
                  type="number"
                  min={1}
                  value={linha.quantity}
                  onChange={(e) => setLinha(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                {idx === 0 && <p className="label-base">Unit. (R$)</p>}
                <Input
                  type="number"
                  step="0.01"
                  value={linha.unitPrice}
                  onChange={(e) => setLinha(idx, { unitPrice: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setItens((arr) => arr.filter((_, i) => i !== idx))}
                  className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-danger dark:hover:bg-navy-800"
                  aria-label="Remover"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setItens((arr) => [...arr, { kind: 'SERVICO', description: '', quantity: 1, unitPrice: 0 }])}
          >
            + Adicionar linha
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
          <p className="label-base">Buscar peça no estoque</p>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome da peça…" />
          {busca.trim().length >= 2 && (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {(produtos?.data ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setItens((arr) => [
                      ...arr,
                      { kind: 'PECA', description: p.name, quantity: 1, unitPrice: p.salePrice ?? 0, productId: p.id },
                    ]);
                    setBusca('');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-navy-800"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-slate-500">{formatCurrency(p.salePrice)}</span>
                </button>
              ))}
              {(produtos?.data ?? []).length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Nenhuma peça encontrada.</p>}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Garantia (dias)">
            <Input type="number" min={0} value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} />
          </Field>
          <Field label="Desconto (R$)">
            <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end">
            <p className="label-base">Total</p>
            <p className="text-lg font-extrabold text-navy-900 dark:text-slate-100">{formatCurrency(total)}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Entrega

function EntregaModal({ os, onClose }: { os: ServiceOrder; onClose: () => void }) {
  const { success, error } = useToast();
  const entregar = useAcaoDeOrdem((data: Record<string, unknown>) => ordemService.entregar(os.id, data));

  const bruto = os.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const [discount, setDiscount] = useState(String(os.discount || ''));
  const total = Math.max(0, bruto - (Number(discount) || 0));

  const [pagamentos, setPagamentos] = useState<{ method: string; amount: string }[]>([
    { method: 'PIX', amount: total.toFixed(2) },
  ]);
  const [warrantyDays, setWarrantyDays] = useState(String(os.warrantyDays ?? 90));
  const [notes, setNotes] = useState('');

  const somaPg = pagamentos.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const falta = Number((total - somaPg).toFixed(2));

  const confirmar = async () => {
    if (Math.abs(falta) > 0.005) return error(`As formas de pagamento precisam somar ${formatCurrency(total)}.`);
    try {
      const r = await entregar.mutateAsync({
        payments: pagamentos.map((p) => ({ method: p.method, amount: Number(p.amount) || 0 })),
        discount: Number(discount) || 0,
        warrantyDays: warrantyDays ? Number(warrantyDays) : null,
        notes: notes.trim() || null,
      });
      success((r.message as string) ?? 'OS entregue.');
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro ao entregar a OS.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Entregar OS ${os.code}`}
      subtitle="Gera a venda, baixa as peças do estoque e registra a garantia"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" onClick={confirmar} loading={entregar.isPending}>
            Confirmar entrega
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-navy-800/50">
          <div className="flex justify-between">
            <span className="text-slate-500">Peças + mão de obra</span>
            <span>{formatCurrency(bruto)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-slate-500">Desconto</span>
            <Input
              type="number"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="h-8 w-28 text-right"
            />
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold dark:border-navy-700">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="label-base">Como o cliente pagou</p>
          {pagamentos.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                value={p.method}
                onChange={(e) =>
                  setPagamentos((arr) => arr.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))
                }
                options={PAYMENT_OPTIONS}
                className="flex-1"
              />
              <Input
                type="number"
                step="0.01"
                value={p.amount}
                onChange={(e) => setPagamentos((arr) => arr.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                className="w-32 text-right"
              />
              {pagamentos.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPagamentos((arr) => arr.filter((_, i) => i !== idx))}
                  className="rounded p-2 text-slate-400 hover:text-danger"
                  aria-label="Remover"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPagamentos((arr) => [...arr, { method: 'DINHEIRO', amount: Math.max(0, falta).toFixed(2) }])
              }
            >
              + Outra forma
            </Button>
            {Math.abs(falta) > 0.005 && (
              <span className={`text-xs font-semibold ${falta > 0 ? 'text-warning' : 'text-danger'}`}>
                {falta > 0 ? `Falta ${formatCurrency(falta)}` : `Sobra ${formatCurrency(-falta)}`}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Garantia do serviço (dias)">
            <Input type="number" min={0} value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} />
          </Field>
          <Field label="Observação (sai no comprovante)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
