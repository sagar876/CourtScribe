import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { handleChunkPreloadErrors } from './lib/lazyPage.ts';
import './index.css';

// StrictMode is intentionally omitted: its dev-only double render/effect
// invocation would distort the render counters the Performance Lab measures.
handleChunkPreloadErrors();

createRoot(document.getElementById('root')!).render(<App />);
