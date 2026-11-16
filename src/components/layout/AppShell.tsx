import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { RecordingIndicator } from '../../features/recording/RecordingIndicator.tsx';
import { recorder } from '../../features/recording/recordingSession.ts';
import { Icon } from '../ui/Icon.tsx';
import { Sidebar } from './Sidebar.tsx';

const STORAGE_KEY = 'courtscribe.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable — preference just isn't persisted */
    }
  }, [collapsed]);

  // Close the drawer when the route changes (adjusting state during render, no extra effect pass).
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setDrawerOpen(false);
  }

  // Device changes, tab visibility and the leave-page warning for an active recording.
  useEffect(() => recorder.attachGlobalListeners(), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-full">
      {/* Desktop rail */}
      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </div>

      {/* Small-screen drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawerOpen(false)} />
          <div className="relative h-full w-60 shadow-xl">
            <Sidebar collapsed={false} variant="drawer" onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <RecordingIndicator />
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
            <Icon name="menu" className="size-5" />
          </button>
          <span className="text-sm font-semibold text-navy-900">CourtScribe</span>
        </header>
        {/* `relative` makes the scroll container the containing block for absolutely positioned descendants
            (e.g. screen-reader-only text); otherwise they are placed against <body> and stretch the document. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
