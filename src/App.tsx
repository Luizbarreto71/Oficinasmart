import { AppLayout } from '@/components/layout/AppLayout';
import { FullScreenLoader } from '@/components/ui/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { pode, telaInicial, type Permissao } from '@/lib/permissoes';
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const StockPage = lazy(() => import('./pages/StockPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const MovementsPage = lazy(() => import('./pages/MovementsPage'));
const StockMovementPage = lazy(() => import('./pages/StockMovementPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CaixaPage = lazy(() => import('./pages/CaixaPage'));
const PreSalePage = lazy(() => import('./pages/PreSalePage'));
const EmAbertoPage = lazy(() => import('./pages/EmAbertoPage'));
const TrocasPage = lazy(() => import('./pages/TrocasPage'));
const MetasPage = lazy(() => import('./pages/MetasPage'));
const SeminovosPage = lazy(() => import('./pages/SeminovosPage'));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function Tela({ permissao, children }: { permissao?: Permissao; children: ReactNode }) {
  const { user } = useAuth();

  if (permissao && !pode(user?.role, permissao)) {
    return <Navigate to={telaInicial(user?.role)} replace />;
  }
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>;
}

function Inicio() {
  const { user } = useAuth();

  if (pode(user?.role, 'dashboard')) {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <DashboardPage />
      </Suspense>
    );
  }
  return <Navigate to={telaInicial(user?.role)} replace />;
}

export function App() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <FullScreenLoader /> : isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Inicio />} />
        <Route path="/caixa" element={<Tela permissao="pdv"><CaixaPage /></Tela>} />
        <Route path="/pre-vendas" element={<Tela permissao="prevenda.criar"><PreSalePage /></Tela>} />
        <Route path="/trocas" element={<Tela permissao="troca.criar"><TrocasPage /></Tela>} />
        <Route path="/em-aberto" element={<Tela permissao="prevenda.verTodas"><EmAbertoPage /></Tela>} />
        <Route path="/metas" element={<Tela permissao="relatorios"><MetasPage /></Tela>} />
        <Route path="/seminovos" element={<Tela permissao="estoque.tela"><SeminovosPage /></Tela>} />
        <Route path="/estoque" element={<Tela permissao="estoque.tela"><StockPage /></Tela>} />
        <Route path="/vendas" element={<Tela permissao="prevenda.verTodas"><SalesPage /></Tela>} />
        <Route path="/movimentacao" element={<Tela permissao="estoque.movimentar"><StockMovementPage /></Tela>} />
        <Route path="/movimentacoes" element={<Tela permissao="estoque.ver"><MovementsPage /></Tela>} />
        <Route path="/clientes" element={<Tela permissao="prevenda.verTodas"><CustomersPage /></Tela>} />
        <Route path="/relatorios" element={<Tela permissao="relatorios"><ReportsPage /></Tela>} />
        <Route path="/configuracoes" element={<Tela permissao="configuracoes"><SettingsPage /></Tela>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
