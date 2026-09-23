import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DataProvider, useData } from './lib/store';
import { UIProvider } from './components/UIProvider';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { LeadsPage } from './pages/Leads';
import { LeadDetailPage } from './pages/LeadDetail';
import { CallMode } from './pages/CallMode';
import { FollowUps } from './pages/FollowUps';
import { Projects } from './pages/Projects';
import { Analytics } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';

function Routed() {
  const { loaded } = useData();
  if (!loaded)
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-accent" /> Loading…
        </div>
      </div>
    );
  return (
    <UIProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetailPage />} />
          <Route path="call" element={<CallMode />} />
          <Route path="follow-ups" element={<FollowUps />} />
          <Route path="projects" element={<Projects />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="py-20 text-center text-muted">Page not found.</div>} />
        </Route>
      </Routes>
    </UIProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <DataProvider>
        <Routed />
      </DataProvider>
    </BrowserRouter>
  );
}
