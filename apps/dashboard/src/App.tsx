import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { getStoredApiKey } from './lib/api';
import { AdminPage } from './pages/Admin';
import { LoginPage } from './pages/Login';
import { OrderDetailPage } from './pages/OrderDetail';
import { OrdersPage } from './pages/Orders';
import { OverviewPage } from './pages/Overview';
import { ProfilesPage } from './pages/Profiles';

export function App() {
  const [authed, setAuthed] = useState(() => !!getStoredApiKey());

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
