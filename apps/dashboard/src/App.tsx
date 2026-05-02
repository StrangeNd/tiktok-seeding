import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastViewport } from './components/ToastViewport';
import { Accounts } from './pages/Accounts';
import { Admin } from './pages/Admin';
import { Jobs } from './pages/Jobs';
import { Login } from './pages/Login';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { Overview } from './pages/Overview';
import { Profiles } from './pages/Profiles';
import { Proxies } from './pages/Proxies';
import { Settings } from './pages/Settings';
import { useAuth } from './store/auth';

declare const __DASHBOARD_BASE__: string;

function RequireAuth({ children }: { children: React.ReactNode }) {
  const ok = useAuth((s) => s.isAuthenticated);
  return ok ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Router basename={typeof __DASHBOARD_BASE__ !== 'undefined' ? __DASHBOARD_BASE__ : undefined}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Overview />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="proxies" element={<Proxies />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="admin" element={<Admin />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastViewport />
    </Router>
  );
}
