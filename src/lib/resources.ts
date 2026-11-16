/**
 * Live resource registry. Every long-lived resource (socket, worker, observer,
 * timer loop, chart) registers here and releases on cleanup, so the
 * Performance Lab can show that navigating away really frees things.
 */
export type ResourceKind = 'websocket' | 'worker' | 'observer' | 'raf-loop' | 'interval' | 'chart' | 'audio' | 'waveform' | 'object-url' | 'media-stream' | 'audio-context';

type Listener = () => void;

const counts = new Map<ResourceKind, number>();
const listeners = new Set<Listener>();
let snapshot: Readonly<Record<string, number>> = {};

let scheduled = false;

/**
 * Notify asynchronously (coalesced per microtask). Resources can be created
 * while React is rendering (e.g. a lazy useState initializer); a synchronous
 * notification would update other components mid-render.
 */
function publish(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    snapshot = Object.fromEntries(counts);
    for (const l of listeners) l();
  });
}

export function trackResource(kind: ResourceKind): () => void {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts.set(kind, (counts.get(kind) ?? 1) - 1);
    publish();
  };
}

export const resourceRegistry = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
};
