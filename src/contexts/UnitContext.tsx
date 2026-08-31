import { useAuth } from '@/contexts/AuthContext';
import { unitService } from '@/services';
import { STORAGE_KEYS } from '@/lib/api';
import type { Unit } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface UnitContextValue {
  unidades: Unit[];
  carregando: boolean;
  unidadeId: string | null;
  unidade: Unit | null;
  definirUnidade: (id: string | null) => void;
  podeTrocar: boolean;
  rotulo: string;
}

const UnitContext = createContext<UnitContextValue | undefined>(undefined);

/**
 * Guarda qual unidade está sendo olhada. O administrador escolhe livremente
 * (inclusive "Todas"); gerente e vendedor ficam presos à sua.
 */
export function UnitProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const ehAdmin = user?.role === 'ADMIN';

  const { data: unidades, isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: unitService.list,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  const [unidadeId, setUnidadeId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.unidade));

  useEffect(() => {
    if (!ehAdmin && user?.unitId) setUnidadeId(user.unitId);
  }, [ehAdmin, user?.unitId]);

  useEffect(() => {
    if (!unidades?.length || !unidadeId) return;
    if (!unidades.some((u) => u.id === unidadeId)) setUnidadeId(null);
  }, [unidades, unidadeId]);

  const definirUnidade = (id: string | null) => {
    setUnidadeId(id);
    if (id) localStorage.setItem(STORAGE_KEYS.unidade, id);
    else localStorage.removeItem(STORAGE_KEYS.unidade);
  };

  const valor = useMemo<UnitContextValue>(() => {
    const lista = unidades ?? [];
    const atual = lista.find((u) => u.id === unidadeId) ?? null;

    return {
      unidades: lista,
      carregando: isLoading,
      unidadeId,
      unidade: atual,
      definirUnidade,
      podeTrocar: ehAdmin && lista.length > 1,
      rotulo: atual?.name ?? 'Todas as unidades',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidades, isLoading, unidadeId, ehAdmin]);

  return <UnitContext.Provider value={valor}>{children}</UnitContext.Provider>;
}

export function useUnit(): UnitContextValue {
  const contexto = useContext(UnitContext);
  if (!contexto) throw new Error('useUnit precisa estar dentro de <UnitProvider>');
  return contexto;
}
