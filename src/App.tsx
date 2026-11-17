import { Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { AppShell } from "./components/layout/AppShell.tsx";
import { RouteErrorBoundary } from "./components/layout/RouteErrorBoundary.tsx";
import { lazyPage } from "./lib/lazyPage.ts";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";

// Performance Lab pulls in G2Plot; load it only when the route is visited.
const PerformanceLabPage = lazyPage(() =>
  import("./pages/PerformanceLabPage.tsx").then((m) => m.PerformanceLabPage),
);
const RecordingsPage = lazyPage(() =>
  import("./pages/RecordingsPage.tsx").then((m) => m.RecordingsPage),
);
const DocumentsPage = lazyPage(() =>
  import("./pages/DocumentsPage.tsx").then((m) => m.DocumentsPage),
);
// pdf.js and Tiptap/Yjs are large: loaded only on the pages that use them.
const DocumentDetailPage = lazyPage(() =>
  import("./pages/DocumentDetailPage.tsx").then((m) => m.DocumentDetailPage),
);
const EditorListPage = lazyPage(() =>
  import("./pages/EditorListPage.tsx").then((m) => m.EditorListPage),
);
const EditorPage = lazyPage(() =>
  import("./pages/EditorPage.tsx").then((m) => m.EditorPage),
);

/** A fresh boundary per route, so an error on one page never sticks to the next. */
function Page({
  children,
  loading = "Loading…",
}: {
  children: React.ReactNode;
  loading?: string;
}) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary key={pathname}>
      <Suspense
        fallback={
          <p className="text-sm text-slate-500" role="status">
            {loading}
          </p>
        }
      >
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
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
            path="recordings"
            element={
              <Page>
                <RecordingsPage />
              </Page>
            }
          />
          <Route
            path="documents"
            element={
              <Page>
                <DocumentsPage />
              </Page>
            }
          />
          <Route
            path="documents/:id"
            element={
              <Page loading="Loading document…">
                <DocumentDetailPage />
              </Page>
            }
          />
          <Route
            path="editor"
            element={
              <Page>
                <EditorListPage />
              </Page>
            }
          />
          <Route
            path="editor/:id"
            element={
              <Page loading="Loading editor…">
                <EditorPage />
              </Page>
            }
          />
          <Route
            path="performance-lab"
            element={
              <Page loading="Loading Performance Lab…">
                <PerformanceLabPage />
              </Page>
            }
          />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
