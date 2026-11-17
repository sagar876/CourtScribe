import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { handleChunkPreloadErrors } from './lib/lazyPage.ts';
import './index.css';

// StrictMode is intentionally omitted: its dev-only double render/effect
// invocation would distort render measurements.
handleChunkPreloadErrors();

// Offline support (production builds only, so it never interferes with the dev server).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(<App />);
