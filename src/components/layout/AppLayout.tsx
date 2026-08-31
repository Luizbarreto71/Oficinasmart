import { STORAGE_KEYS } from '@/lib/api';
import { startOfflineWatcher } from '@/lib/offline';
import { useToast } from '@/contexts/ToastContext';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.sidebar) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { success, warning } = useToast();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sidebar, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(
    () =>
      startOfflineWatcher((r) => {
        if (r.sent) success(`${r.sent} operação(ões) offline sincronizada(s).`);
        if (r.failed) warning(`${r.failed} operação(ões) offline foram recusadas pelo servidor.`);
      }),
    [success, warning],
  );

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto max-w-7xl space-y-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
