import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { ClientList } from './pages/ClientList';
import { ClientProfile } from './pages/ClientProfile';
import { NewsFeed } from './pages/NewsFeed';
import { SettingsPage } from './pages/Settings';
import { CallSession } from './pages/CallSession';
import { ClientSummary } from './pages/ClientSummary';
import { CalendarPage } from './pages/Calendar';
import { PracticeDashboard } from './pages/Practice';
import { Toaster } from './components/ui/toaster';
import { useAppStore } from './store/appStore';

// ─── Full-screen loading screen shown while synthetic data is fetched ─────────

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <div className="w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
      <p className="text-sm text-gray-500 font-medium">Loading client data…</p>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const loadSyntheticData  = useAppStore((s) => s.loadSyntheticData);
  const isLoadingClients   = useAppStore((s) => s.isLoadingClients);
  const clientCount        = useAppStore((s) => s.clients.length);

  // Kick off the fetch on first mount (no-ops if localStorage already has clients)
  useEffect(() => {
    loadSyntheticData();
  }, [loadSyntheticData]);

  // Show spinner until we have at least one client (either fetched or rehydrated)
  if (isLoadingClients || clientCount === 0) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Full-screen focused pages (no sidebar layout) */}
        <Route path="/clients/:id/call" element={<CallSession />} />
        <Route path="/clients/:id/summary" element={<ClientSummary />} />

        <Route element={<Layout />}>
          <Route path="/" element={<PracticeDashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/practice" element={<PracticeDashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/clients" element={<ClientList />} />
          <Route path="/clients/:id" element={<ClientProfile />} />
          <Route path="/news" element={<NewsFeed />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
