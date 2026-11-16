import type { TranscriptSegment } from '../../../../shared/transcript.ts';
import { trackResource } from '../../../lib/resources.ts';
import type { SearchRequest, SearchResponse } from '../../transcript/search.worker.ts';
import { searchKey } from '../../transcript/searchCore.ts';
import type { TranscriptStore } from '../../transcript/TranscriptStore.ts';

export interface BenchSearch {
  totalMs: number;
  /** Time the main thread was busy for this search. */
  mainThreadMs: number;
  hits: number;
}

/** Variant A: Array.filter over the state array, on the main thread. */
export function naiveSearch(segments: readonly TranscriptSegment[], query: string): BenchSearch {
  const q = query.toLowerCase();
  const t0 = performance.now();
  const hits = segments.filter((s) => `${s.speakerName} ${s.text}`.toLowerCase().includes(q)).length;
  const ms = performance.now() - t0;
  return { totalMs: ms, mainThreadMs: ms, hits };
}

/**
 * Variant B: the same Web Worker the viewer uses. The index is loaded first
 * (the real viewer keeps it in sync incrementally), then only the query is timed.
 */
export async function workerSearch(store: TranscriptStore, query: string): Promise<BenchSearch> {
  const worker = new Worker(new URL('../../transcript/search.worker.ts', import.meta.url), { type: 'module' });
  const release = trackResource('worker');
  try {
    const keys = new Array<string>(store.size);
    for (let i = 0; i < store.size; i++) keys[i] = searchKey(store.at(i)!);
    const next = () =>
      new Promise<SearchResponse>((resolve) => {
        worker.onmessage = (e: MessageEvent<SearchResponse>) => resolve(e.data);
      });
    // Load + warm-up query so index transfer is not counted as search time.
    worker.postMessage({ type: 'load', keys } satisfies SearchRequest);
    let pending = next();
    worker.postMessage({ type: 'search', id: 0, query: '\u0000' } satisfies SearchRequest);
    await pending;
    pending = next();
    const t0 = performance.now();
    worker.postMessage({ type: 'search', id: 1, query } satisfies SearchRequest);
    const mainThreadMs = performance.now() - t0;
    const r = await pending;
    return { totalMs: performance.now() - t0, mainThreadMs, hits: r.matches.length };
  } finally {
    worker.terminate();
    release();
  }
}
