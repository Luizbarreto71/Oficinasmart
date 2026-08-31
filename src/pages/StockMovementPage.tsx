import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useMovimentarEstoque, useProducts } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { EXIT_REASON_OPTIONS } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMemo, useState } from 'react';

type Aba = 'entrada' | 'saida' | 'ajuste' | 'transferir';

const ABAS: { key: Aba; label: string }[] = [
  { key: 'entrada', label: 'Entrada' },
  { key: 'saida', label: 'Saída' },
  { key: 'ajuste', label: 'Ajuste' },
  { key: 'transferir', label: 'Transferência' },
];

export default function StockMovementPage() {
  const { success, error } = useToast();
  const { unidades, unidadeId } = useUnit();
  const [aba, setAba] = useState<Aba>('entrada');

  const [busca, setBusca] = useState('');
  const debounced = useDebounce(busca, 300);
  const { data: produtos } = useProducts(useMemo(() => ({ search: debounced || undefined, tipoControle: 'QUANTIDADE', pageSize: 20 }), [debounced]));

  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState(unidadeId ?? '');
  const [destUnitId, setDestUnitId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [reason, setReason] = useState('OUTRO');
  const [notes, setNotes] = useState('');

  const mut = useMovimentarEstoque(aba === 'ajuste' ? 'ajustar' : aba);

  const enviar = async () => {
    if (!productId || !unitId) return error('Escolha o produto e a unidade.');
    try {
      const base: Record<string, unknown> = { productId, unitId, notes: notes || undefined };
      if (aba === 'entrada') {
        base.quantity = Number(quantity);
        base.costPrice = costPrice ? Number(costPrice) : undefined;
      } else if (aba === 'saida') {
        base.quantity = Number(quantity);
        base.reason = reason;
      } else if (aba === 'ajuste') {
        base.newQuantity = Number(newQuantity);
      } else {
        if (!destUnitId) return error('Escolha a unidade de destino.');
        delete base.unitId;
        base.originUnitId = unitId;
        base.destinationUnitId = destUnitId;
        base.productId = productId;
        base.quantity = Number(quantity);
      }
      const r = await mut.mutateAsync(base);
      success((r.message as string) ?? 'Movimentação registrada.');
      setQuantity('');
      setNewQuantity('');
      setCostPrice('');
      setNotes('');
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Movimentação de estoque" subtitle="Entrada, saída, ajuste e transferência de produtos por quantidade" />

      <Card>
        <div className="flex border-b border-slate-200 dark:border-navy-700">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={cn(
                'flex-1 px-3 py-2.5 text-sm font-semibold transition',
                aba === a.key ? 'border-b-2 border-accent text-accent' : 'text-slate-500 hover:text-navy-900 dark:hover:text-slate-100',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <CardBody className="space-y-3">
          <Field label="Produto">
            <Input placeholder="Digite para buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </Field>
          {produtos && produtos.data.length > 0 && (
            <Select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Selecione o produto…"
              options={produtos.data.map((p) => ({ value: p.id, label: `${p.name} (${p.quantity} un.)` }))}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={aba === 'transferir' ? 'Unidade de origem' : 'Unidade'}>
              <Select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                placeholder="Selecione…"
                options={unidades.map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>

            {aba === 'transferir' && (
              <Field label="Unidade de destino">
                <Select
                  value={destUnitId}
                  onChange={(e) => setDestUnitId(e.target.value)}
                  placeholder="Selecione…"
                  options={unidades.filter((u) => u.id !== unitId).map((u) => ({ value: u.id, label: u.name }))}
                />
              </Field>
            )}

            {aba === 'ajuste' ? (
              <Field label="Novo saldo">
                <Input type="number" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} />
              </Field>
            ) : (
              <Field label="Quantidade">
                <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            )}

            {aba === 'entrada' && (
              <Field label="Custo unitário (R$)" hint="Recalcula o custo médio">
                <Input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
              </Field>
            )}

            {aba === 'saida' && (
              <Field label="Motivo">
                <Select value={reason} onChange={(e) => setReason(e.target.value)} options={EXIT_REASON_OPTIONS} />
              </Field>
            )}
          </div>

          <Field label={aba === 'ajuste' ? 'Motivo da correção' : 'Observações'}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <Button onClick={enviar} loading={mut.isPending}>
            Registrar {ABAS.find((a) => a.key === aba)?.label.toLowerCase()}
          </Button>
        </CardBody>
      </Card>

      <Card className="border-accent/30 bg-blue-50/50 p-3 text-sm text-slate-600 dark:bg-accent/5 dark:text-slate-300">
        Para dar entrada, baixa ou correção de <strong>smartphones e seminovos</strong> (controlados por aparelho),
        use a aba <strong>Aparelhos</strong> na tela de Estoque.
      </Card>
    </div>
  );
}
