/// <reference lib="webworker" />
import { searchKeys } from './searchCore.ts';

export type SearchRequest =
  | { type: 'load'; keys: string[] }
  | { type: 'append'; keys: string[] }
  | { type: 'update'; updates: [index: number, key: string][] }
  | { type: 'search'; id: number; query: string };

export type SearchResponse = { type: 'result'; id: number; query: string; matches: Int32Array; workerMs: number; indexed: number };

let keys: string[] = [];

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') keys = msg.keys;
  else if (msg.type === 'append') for (const k of msg.keys) keys.push(k);
  else if (msg.type === 'update') for (const [i, k] of msg.updates) keys[i] = k;
  else {
    const t0 = performance.now();
    const matches = searchKeys(keys, msg.query);
    const res: SearchResponse = { type: 'result', id: msg.id, query: msg.query, matches, workerMs: performance.now() - t0, indexed: keys.length };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, [matches.buffer]);
  }
};
