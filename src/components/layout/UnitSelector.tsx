import { useUnit } from '@/contexts/UnitContext';
import { Store } from 'lucide-react';

export function UnitSelector() {
  const { unidades, unidadeId, definirUnidade, podeTrocar } = useUnit();

  if (!podeTrocar) return null;

  return (
    <label className="hidden items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-navy-600 dark:bg-navy-800 sm:flex">
      <Store className="h-4 w-4 text-slate-400" />
      <select
        value={unidadeId ?? ''}
        onChange={(e) => definirUnidade(e.target.value || null)}
        className="bg-transparent text-sm font-medium text-navy-800 outline-none dark:text-slate-100"
      >
        <option value="">Todas as unidades</option>
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}
