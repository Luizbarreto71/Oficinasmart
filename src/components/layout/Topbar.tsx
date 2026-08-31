import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/contexts/ThemeContext';
import { useUnit } from '@/contexts/UnitContext';
import { useMarcarLida, useNotificacoes, useQuickSearch } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/cn';
import { formatCurrency, formatRelative } from '@/lib/format';
import { Bell, Menu, Moon, Search, Sun, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UnitSelector } from './UnitSelector';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const { rotulo } = useUnit();
  const online = useOnlineStatus();
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const debounced = useDebounce(term, 300);
  const { data: resultados } = useQuickSearch(debounced);

  const [bellOpen, setBellOpen] = useState(false);
  const { data: avisos } = useNotificacoes();
  const marcarLida = useMarcarLida();

  const searchRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setSearchOpen(true);
        document.getElementById('busca-global')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/80 px-3 backdrop-blur dark:border-navy-700 dark:bg-navy-900/80 sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div ref={searchRef} className="relative flex-1 max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="busca-global"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Buscar por IMEI, produto, cliente…  ( / )"
          className="input-base pl-9"
        />
        {searchOpen && debounced.length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-card-hover dark:border-navy-700 dark:bg-navy-900">
            {!resultados ||
            (resultados.products.length === 0 &&
              resultados.sales.length === 0 &&
              resultados.customers.length === 0) ? (
              <p className="px-3 py-4 text-sm text-slate-500">Nada encontrado.</p>
            ) : (
              <div className="py-1 text-sm">
                {resultados.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      navigate('/estoque');
                      setSearchOpen(false);
                      setTerm('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{p.name}</span>
                      {p.imei && <span className="ml-2 text-xs text-slate-400">IMEI {p.imei}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
                {resultados.customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      navigate('/clientes');
                      setSearchOpen(false);
                      setTerm('');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <Badge tone="info">Cliente</Badge>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <span className="hidden text-xs font-medium text-slate-500 dark:text-slate-400 md:inline">{rotulo}</span>
      <UnitSelector />

      {!online && (
        <span className="flex items-center gap-1 rounded-lg bg-warning-bg px-2 py-1 text-xs font-semibold text-warning dark:bg-warning/15">
          <WifiOff className="h-3.5 w-3.5" /> Offline
        </span>
      )}

      <button
        type="button"
        onClick={toggleTheme}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800"
        aria-label="Alternar tema"
      >
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      <div ref={bellRef} className="relative">
        <button
          type="button"
          onClick={() => setBellOpen((v) => !v)}
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800"
          aria-label="Avisos"
        >
          <Bell className="h-5 w-5" />
          {(avisos?.unread ?? 0) > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {avisos!.unread}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute right-0 top-full mt-1 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card-hover dark:border-navy-700 dark:bg-navy-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-navy-700">
              <span className="text-sm font-bold">Avisos</span>
              {(avisos?.unread ?? 0) > 0 && (
                <button
                  onClick={() => marcarLida.mutate(undefined)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Marcar todos como lidos
                </button>
              )}
            </div>
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-navy-800">
              {!avisos?.data.length ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Sem avisos.</p>
              ) : (
                avisos.data.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      marcarLida.mutate(n.id);
                      if (n.link) navigate(n.link);
                      setBellOpen(false);
                    }}
                    className={cn(
                      'block w-full px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-navy-800',
                      !n.read && 'bg-blue-50/50 dark:bg-accent/5',
                    )}
                  >
                    <p className="text-sm font-semibold text-navy-900 dark:text-slate-100">{n.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{formatRelative(n.createdAt)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
