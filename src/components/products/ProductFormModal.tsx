import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useCategories, useCreateProduct, useSuppliers, useUpdateProduct } from '@/hooks/queries';
import { deviceService } from '@/services';
import type { Product } from '@/types';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PhotoUploader } from './PhotoUploader';

interface Props {
  open: boolean;
  onClose: () => void;
  produto?: Product | null;
}

interface Aparelho {
  imei: string;
  serialNumber: string;
  condicao: string;
  batteryHealth: string;
  costPrice: string;
}

const aparelhoVazio: Aparelho = { imei: '', serialNumber: '', condicao: 'Novo / Lacrado', batteryHealth: '', costPrice: '' };

export function ProductFormModal({ open, onClose, produto }: Props) {
  const editando = Boolean(produto);
  const { success, error } = useToast();
  const { unidadeId, unidades } = useUnit();
  const { data: categorias } = useCategories();
  const { data: fornecedores } = useSuppliers({ all: 'true' });
  const criar = useCreateProduct();
  const atualizar = useUpdateProduct();

  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    tipoControle: 'QUANTIDADE' as 'UNITARIO' | 'QUANTIDADE',
    semEstoque: false,
    brand: '',
    model: '',
    color: '',
    capacity: '',
    ram: '',
    barcode: '',
    condicao: '',
    minQuantity: '1',
    costPrice: '',
    salePrice: '',
    wholesalePrice: '',
    garantiaPadraoDias: '',
    supplierId: '',
    notes: '',
    quantity: '0',
    unitId: unidadeId ?? '',
    imei: '',
    serialNumber: '',
  });
  const [photos, setPhotos] = useState<string[]>([]);
  const [aparelhos, setAparelhos] = useState<Aparelho[]>([aparelhoVazio]);
  const [imeiAviso, setImeiAviso] = useState<Record<number, string>>({});

  const categoria = useMemo(
    () => categorias?.find((c) => c.id === form.categoryId),
    [categorias, form.categoryId],
  );

  useEffect(() => {
    if (!open) return;
    if (produto) {
      setForm({
        name: produto.name,
        categoryId: produto.categoryId,
        tipoControle: produto.tipoControle,
        semEstoque: Boolean(produto.semEstoque),
        brand: produto.brand ?? '',
        model: produto.model ?? '',
        color: produto.color ?? '',
        capacity: produto.capacity ?? '',
        ram: produto.ram ?? '',
        barcode: produto.barcode ?? '',
        condicao: produto.condicao ?? '',
        minQuantity: String(produto.minQuantity),
        costPrice: String(produto.costPrice ?? ''),
        salePrice: String(produto.salePrice ?? ''),
        wholesalePrice: produto.wholesalePrice != null ? String(produto.wholesalePrice) : '',
        garantiaPadraoDias: produto.garantiaPadraoDias != null ? String(produto.garantiaPadraoDias) : '',
        supplierId: produto.supplierId ?? '',
        notes: produto.notes ?? '',
        quantity: String(produto.quantity ?? 0),
        unitId: unidadeId ?? '',
        imei: produto.imei ?? '',
        serialNumber: produto.serialNumber ?? '',
      });
      setPhotos(produto.photos ?? []);
    } else {
      setForm((f) => ({ ...f, name: '', unitId: unidadeId ?? '' }));
      setPhotos([]);
      setAparelhos([aparelhoVazio]);
    }
    setImeiAviso({});
  }, [open, produto, unidadeId]);

  // Ao trocar de categoria (só no cadastro), sugere o tipo de controle dela.
  useEffect(() => {
    if (editando || !categoria) return;
    setForm((f) => ({ ...f, tipoControle: categoria.tipoControlePadrao ?? 'QUANTIDADE' }));
  }, [categoria, editando]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const conferirImei = async (i: number, imei: string) => {
    const limpo = imei.replace(/\D/g, '');
    if (limpo.length < 6) return setImeiAviso((a) => ({ ...a, [i]: '' }));
    try {
      const r = await deviceService.porImei(limpo);
      setImeiAviso((a) => ({ ...a, [i]: r.encontrado ? `⚠ Já cadastrado: ${r.resumo}` : '' }));
    } catch {
      /* silencioso */
    }
  };

  const unitario = form.tipoControle === 'UNITARIO';

  const salvar = async () => {
    if (!form.name.trim() || !form.categoryId) {
      error('Informe nome e categoria.');
      return;
    }

    const base: Record<string, unknown> = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      tipoControle: form.tipoControle,
      semEstoque: form.semEstoque,
      brand: form.brand || null,
      model: form.model || null,
      color: form.color || null,
      capacity: form.capacity || null,
      ram: form.ram || null,
      barcode: form.barcode || null,
      condicao: form.condicao || null,
      minQuantity: Number(form.minQuantity) || 1,
      costPrice: Number(form.costPrice) || 0,
      salePrice: Number(form.salePrice) || 0,
      wholesalePrice: form.wholesalePrice ? Number(form.wholesalePrice) : null,
      garantiaPadraoDias: form.garantiaPadraoDias ? Number(form.garantiaPadraoDias) : null,
      supplierId: form.supplierId || null,
      notes: form.notes || null,
      photos,
    };

    try {
      if (editando && produto) {
        await atualizar.mutateAsync({ id: produto.id, data: base });
        success('Produto atualizado.');
      } else {
        if (unitario && !form.semEstoque) {
          base.aparelhos = aparelhos
            .filter((a) => a.imei || a.serialNumber || a.costPrice)
            .map((a) => ({
              imei: a.imei.replace(/\D/g, '') || null,
              serialNumber: a.serialNumber || null,
              condicao: a.condicao || null,
              batteryHealth: a.batteryHealth ? Number(a.batteryHealth) : null,
              costPrice: a.costPrice ? Number(a.costPrice) : Number(form.costPrice) || 0,
            }));
          base.unitId = form.unitId || undefined;
        } else if (!form.semEstoque) {
          base.quantity = Number(form.quantity) || 0;
          base.unitId = form.unitId || undefined;
          base.imei = form.imei || null;
          base.serialNumber = form.serialNumber || null;
        }
        await criar.mutateAsync(base);
        success('Produto cadastrado.');
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar';
      if (msg === 'OFFLINE_QUEUED') {
        success('Sem internet: cadastro salvo na fila e será enviado depois.');
        onClose();
      } else {
        error(msg);
      }
    }
  };

  const salvando = criar.isPending || atualizar.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? `Editar ${produto?.name}` : 'Novo produto'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando}>
            {editando ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>

          <Field label="Categoria" required>
            <Select
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              placeholder="Selecione…"
              options={(categorias ?? []).map((c) => ({ value: c.id, label: c.caminho ?? c.name }))}
            />
          </Field>

          <Field label="Tipo de controle" hint={unitario ? 'Cada aparelho é rastreado por IMEI/série' : 'Só um saldo por unidade'}>
            <Select
              value={form.tipoControle}
              onChange={(e) => set('tipoControle', e.target.value)}
              options={[
                { value: 'QUANTIDADE', label: 'Por quantidade' },
                { value: 'UNITARIO', label: 'Por aparelho (IMEI)' },
              ]}
              disabled={editando}
            />
          </Field>

          <Field label="Marca">
            <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label="Modelo">
            <Input value={form.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label="Cor">
            <Input value={form.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="Capacidade">
            <Input value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="256GB" />
          </Field>
          {unitario && (
            <Field label="RAM">
              <Input value={form.ram} onChange={(e) => set('ram', e.target.value)} placeholder="8GB" />
            </Field>
          )}
          {!unitario && (
            <Field label="Código de barras">
              <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
            </Field>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Custo médio (R$)">
            <Input
              type="number"
              step="0.01"
              value={form.costPrice}
              onChange={(e) => set('costPrice', e.target.value)}
            />
          </Field>
          <Field label="Preço de venda (R$)">
            <Input
              type="number"
              step="0.01"
              value={form.salePrice}
              onChange={(e) => set('salePrice', e.target.value)}
            />
          </Field>
          <Field label="Preço de atacado (R$)" hint="Vira o piso da venda">
            <Input
              type="number"
              step="0.01"
              value={form.wholesalePrice}
              onChange={(e) => set('wholesalePrice', e.target.value)}
            />
          </Field>
          <Field label="Estoque mínimo">
            <Input
              type="number"
              value={form.minQuantity}
              onChange={(e) => set('minQuantity', e.target.value)}
            />
          </Field>
          {unitario && (
            <Field label="Garantia padrão (dias)">
              <Input
                type="number"
                value={form.garantiaPadraoDias}
                onChange={(e) => set('garantiaPadraoDias', e.target.value)}
              />
            </Field>
          )}
          <Field label="Fornecedor">
            <Select
              value={form.supplierId}
              onChange={(e) => set('supplierId', e.target.value)}
              placeholder="—"
              options={(fornecedores?.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
            />
          </Field>
        </div>

        {!editando && !form.semEstoque && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-navy-700 dark:bg-navy-800/40">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Estoque inicial</p>
              <Select
                className="h-8 w-40 text-xs"
                value={form.unitId}
                onChange={(e) => set('unitId', e.target.value)}
                placeholder="Unidade…"
                options={unidades.map((u) => ({ value: u.id, label: u.name }))}
              />
            </div>

            {unitario ? (
              <div className="space-y-2">
                {aparelhos.map((a, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-2 dark:bg-navy-900 sm:grid-cols-5">
                    <Input
                      placeholder="IMEI"
                      value={a.imei}
                      onChange={(e) => {
                        const v = [...aparelhos];
                        v[i] = { ...v[i], imei: e.target.value };
                        setAparelhos(v);
                      }}
                      onBlur={(e) => conferirImei(i, e.target.value)}
                    />
                    <Input
                      placeholder="Nº série"
                      value={a.serialNumber}
                      onChange={(e) => {
                        const v = [...aparelhos];
                        v[i] = { ...v[i], serialNumber: e.target.value };
                        setAparelhos(v);
                      }}
                    />
                    <Input
                      placeholder="Condição"
                      value={a.condicao}
                      onChange={(e) => {
                        const v = [...aparelhos];
                        v[i] = { ...v[i], condicao: e.target.value };
                        setAparelhos(v);
                      }}
                    />
                    <Input
                      placeholder="Bateria %"
                      type="number"
                      value={a.batteryHealth}
                      onChange={(e) => {
                        const v = [...aparelhos];
                        v[i] = { ...v[i], batteryHealth: e.target.value };
                        setAparelhos(v);
                      }}
                    />
                    <div className="flex gap-1">
                      <Input
                        placeholder="Custo"
                        type="number"
                        step="0.01"
                        value={a.costPrice}
                        onChange={(e) => {
                          const v = [...aparelhos];
                          v[i] = { ...v[i], costPrice: e.target.value };
                          setAparelhos(v);
                        }}
                      />
                      {aparelhos.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setAparelhos(aparelhos.filter((_, j) => j !== i))}
                          className="shrink-0 rounded-lg px-2 text-danger hover:bg-danger-bg"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {imeiAviso[i] && <p className="col-span-full text-xs font-medium text-warning">{imeiAviso[i]}</p>}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAparelhos([...aparelhos, aparelhoVazio])}
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                >
                  <Plus className="h-4 w-4" /> Adicionar aparelho
                </button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Quantidade">
                  <Input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}

        <Field label="Fotos">
          <PhotoUploader photos={photos} onChange={setPhotos} />
        </Field>

        <Field label="Observações">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
