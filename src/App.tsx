import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell } from './components/layout/AppShell.tsx';
import { RouteErrorBoundary } from './components/layout/RouteErrorBoundary.tsx';
import { lazyPage } from './lib/lazyPage.ts';
import { WorkspacePage } from './pages/WorkspacePage.tsx';

// Performance Lab pulls in G2Plot; load it only when the route is visited.
const PerformanceLabPage = lazyPage(() => import('./pages/PerformanceLabPage.tsx').then((m) => m.PerformanceLabPage));

/** A fresh boundary per route, so an error on one page never sticks to the next. */
function Page({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/workspace" replace />} />
          <Route
            path="workspace"
            element={
              <Page>
                <WorkspacePage />
              </Page>
            }
          />
          <Route
            path="performance-lab"
            element={
              <Page>
                <Suspense fallback={<p className="text-sm text-slate-500">Loading Performance Lab…</p>}>
                  <PerformanceLabPage />
                </Suspense>
              </Page>
            }
          />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
