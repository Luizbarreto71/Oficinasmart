import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { useUnit } from '@/contexts/UnitContext';
import { useCategories } from '@/hooks/queries';
import { downloadFile } from '@/lib/api';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';

const RELATORIOS = [
  { key: 'stock', label: 'Estoque', desc: 'Tudo em estoque, por categoria, com valor a custo e a venda' },
  { key: 'sales', label: 'Vendas', desc: 'Itens vendidos no período, com IMEI, lucro e forma de pagamento' },
  { key: 'by-category', label: 'Por categoria', desc: 'Estoque e vendas somados por categoria' },
  { key: 'by-supplier', label: 'Por fornecedor', desc: 'Investido e vendido por fornecedor' },
  { key: 'by-period', label: 'Por período', desc: 'Faturamento e lucro dia a dia ou mês a mês' },
  { key: 'movements', label: 'Movimentações', desc: 'Entradas, saídas, transferências e ajustes' },
  { key: 'by-payment', label: 'Por forma de pagamento', desc: 'Total por forma, taxa da maquininha e a receber' },
];

export default function ReportsPage() {
  const { error } = useToast();
  const { unidadeId } = useUnit();
  const { data: categorias } = useCategories();
  const [rel, setRel] = useState('stock');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [baixando, setBaixando] = useState('');

  const baixar = async (format: 'pdf' | 'xlsx' | 'csv') => {
    setBaixando(format);
    try {
      await downloadFile(
        `/reports/${rel}`,
        {
          format,
          startDate: inicio || undefined,
          endDate: fim || undefined,
          categoryId: categoryId || undefined,
          unitId: unidadeId ?? undefined,
        },
        `${rel}.${format}`,
      );
    } catch (e) {
      error(e instanceof Error ? e.message : 'Erro ao gerar o relatório');
    } finally {
      setBaixando('');
    }
  };

  const atual = RELATORIOS.find((r) => r.key === rel)!;

  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios" subtitle="Gere em PDF, Excel ou CSV" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Escolha o relatório" />
          <CardBody className="space-y-1">
            {RELATORIOS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRel(r.key)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  rel === r.key ? 'bg-accent text-white' : 'hover:bg-slate-100 dark:hover:bg-navy-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={atual.label} subtitle={atual.desc} />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Data inicial">
                <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </Field>
              <Field label="Data final">
                <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
              </Field>
              <Field label="Categoria" className="sm:col-span-2">
                <Select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  placeholder="Todas"
                  options={(categorias ?? []).filter((c) => !c.ehSubcategoria).map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button icon={<FileText className="h-4 w-4" />} onClick={() => baixar('pdf')} loading={baixando === 'pdf'}>
                PDF
              </Button>
              <Button
                variant="outline"
                icon={<FileSpreadsheet className="h-4 w-4" />}
                onClick={() => baixar('xlsx')}
                loading={baixando === 'xlsx'}
              >
                Excel
              </Button>
              <Button variant="outline" icon={<FileDown className="h-4 w-4" />} onClick={() => baixar('csv')} loading={baixando === 'csv'}>
                CSV
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
