import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'courtscribe.chunkReloadAt';

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false; // already tried: let the error boundary explain instead of looping
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * React.lazy for route pages that survives stale chunks: if the page's code
 * can no longer be fetched (the app was rebuilt while this tab was open),
 * reload once to pick up the new build; otherwise surface the error.
 */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch (err) {
      if (reloadOnce()) return new Promise<never>(() => {}); // page is reloading
      throw err;
    }
  });
}

/** Vite emits this when a production chunk preload fails. */
export function handleChunkPreloadErrors(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}
