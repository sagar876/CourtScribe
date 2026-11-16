import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell.tsx';
import { WorkspacePage } from './pages/WorkspacePage.tsx';

// Performance Lab pulls in G2Plot; load it only when the route is visited.
const PerformanceLabPage = lazy(() => import('./pages/PerformanceLabPage.tsx').then((m) => ({ default: m.PerformanceLabPage })));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/workspace" replace />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route
            path="performance-lab"
            element={
              <Suspense fallback={<p className="text-sm text-slate-500">Loading Performance Lab…</p>}>
                <PerformanceLabPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
