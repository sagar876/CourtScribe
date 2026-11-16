import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { trackResource } from '../../lib/resources.ts';
import type { TranscriptStore } from './TranscriptStore.ts';
import { searchKey, searchKeys } from './searchCore.ts';
import type { SearchRequest, SearchResponse } from './search.worker.ts';

export type SearchEngine = 'worker' | 'main-thread';

export interface SearchResult {
  query: string;
  matches: Int32Array;
  /** Time spent scanning (inside the worker, or on the main thread). */
  computeMs: number;
  /** Request → result on the main thread (includes messaging for the worker). */
  totalMs: number;
  engine: SearchEngine;
}

const EMPTY = new Int32Array(0);
const DEBOUNCE_MS = 120;
const LIVE_RESEARCH_MS = 1_000;

function keysFrom(store: TranscriptStore, start = 0): string[] {
  const out = new Array<string>(store.size - start);
  for (let i = start; i < store.size; i++) out[i - start] = searchKey(store.at(i)!);
  return out;
}

/**
 * Transcript search. The worker engine keeps a normalised index off the main
 * thread and is kept in sync with store appends; the main-thread engine is the
 * naive baseline (normalises + scans every segment on the UI thread).
 */
export function useTranscriptSearch(store: TranscriptStore, engine: SearchEngine, query: string) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const sentAt = useRef(new Map<number, number>());
  const queryRef = useRef(query);
  const run = useRef<(q: string) => void>(() => {});

  // Worker lifecycle + index sync.
  useEffect(() => {
    if (engine !== 'worker') return;
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    const release = trackResource('worker');
    workerRef.current = worker;
    const post = (m: SearchRequest) => worker.postMessage(m);
    post({ type: 'load', keys: keysFrom(store) });

    worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      const r = e.data;
      const started = sentAt.current.get(r.id);
      sentAt.current.delete(r.id);
      if (r.id !== reqId.current || started === undefined) return; // stale
      setPending(false);
      setResult({ query: r.query, matches: r.matches, computeMs: r.workerMs, totalMs: performance.now() - started, engine: 'worker' });
    };

    const offReset = store.onReset(() => post({ type: 'load', keys: keysFrom(store) }));
    const inFlight = sentAt.current;
    const offAppend = store.onAppend((added) => post({ type: 'append', keys: added.map(searchKey) }));
    const offUpdate = store.onUpdate((updates) => post({ type: 'update', updates: updates.map((u) => [u.index, searchKey(u.segment)]) }));

    return () => {
      offReset();
      offAppend();
      offUpdate();
      worker.terminate();
      workerRef.current = null;
      inFlight.clear();
      release();
    };
  }, [store, engine]);

  // Latest-value refs, updated after render (never during it) so timers and listeners see fresh values.
  useLayoutEffect(() => {
    queryRef.current = query;
    run.current = runSearch;
  });

  // A reset (dataset switch, cleared live transcript) invalidates match indices.
  useEffect(
    () =>
      store.onReset(() => {
        reqId.current++;
        setPending(false);
        setResult(null);
      }),
    [store],
  );

  function runSearch(q: string) {
    const id = ++reqId.current;
    if (!q.trim()) {
      setPending(false);
      setResult(null);
      return;
    }
    if (engine === 'worker') {
      if (!workerRef.current) return;
      sentAt.current.set(id, performance.now());
      setPending(true);
      workerRef.current.postMessage({ type: 'search', id, query: q } satisfies SearchRequest);
    } else {
      const t0 = performance.now();
      const matches = searchKeys(keysFrom(store), q); // deliberately naive: re-normalises everything per search
      const ms = performance.now() - t0;
      setResult({ query: q, matches, computeMs: ms, totalMs: ms, engine });
    }
  }

  // Debounced search on query / engine / dataset change.
  useEffect(() => {
    const t = setTimeout(() => run.current(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, engine, store]);

  // Keep results fresh while a live transcript grows (throttled).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = store.onAppend(() => {
      if (timer || !queryRef.current.trim()) return;
      timer = setTimeout(() => {
        timer = null;
        run.current(queryRef.current);
      }, LIVE_RESEARCH_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [store]);

  return { result, matches: result?.matches ?? EMPTY, pending };
}
