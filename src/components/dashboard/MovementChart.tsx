import { formatCompactCurrency } from '@/lib/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Ponto {
  date: string;
  vendas: number;
  faturamento: number;
  entradas: number;
  saidas: number;
}

export function MovementChart({ data }: { data: Ponto[] }) {
  const rotulo = (d: string) => {
    const [, m, dia] = d.split('-');
    return `${dia}/${m}`;
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="fat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-navy-700" />
        <XAxis dataKey="date" tickFormatter={rotulo} tick={{ fontSize: 11 }} stroke="currentColor" className="text-slate-400" />
        <YAxis tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fontSize: 11 }} stroke="currentColor" className="text-slate-400" width={64} />
        <Tooltip
          formatter={(v: number, name) => [name === 'faturamento' ? formatCompactCurrency(v) : v, name]}
          labelFormatter={rotulo}
          contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0' }}
        />
        <Area type="monotone" dataKey="faturamento" name="Faturamento" stroke="#2563EB" strokeWidth={2} fill="url(#fat)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
