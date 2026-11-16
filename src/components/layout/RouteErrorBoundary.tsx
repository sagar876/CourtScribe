import { Component, type ReactNode } from 'react';
import { Button } from '../ui/Button.tsx';

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

/**
 * Keeps a failing page from taking down the whole app (sidebar included) and
 * explains what happened. Reset by remounting with a new `key` per route.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = CHUNK_ERROR.test(error.message);
    return (
      <div role="alert" className="mx-auto mt-10 max-w-lg rounded-lg border border-red-200 bg-white p-6">
        <h1 className="text-base font-semibold text-slate-900">{stale ? 'This page needs a refresh' : 'This page could not be displayed'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {stale
            ? 'CourtScribe was updated while this tab was open, so part of the page could not be loaded. Reloading fixes this.'
            : 'Something went wrong while showing this page. Reloading usually fixes it; the rest of the app is unaffected.'}
        </p>
        <p className="mt-2 font-mono text-xs break-words text-slate-500">{error.message}</p>
        <Button className="mt-4" variant="primary" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    );
  }
}
