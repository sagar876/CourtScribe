import type { TranscriptStore } from '../transcript/TranscriptStore.ts';

/**
 * The segment "being spoken" at `ms`: the last segment whose startTime ≤ ms.
 * Silence between two segments keeps the previous one active (caption
 * behaviour, no flicker). O(log n) via the store's binary search — never a scan.
 */
export function resolveActiveSegmentId(store: TranscriptStore, ms: number): string | null {
  if (store.size === 0 || !Number.isFinite(ms)) return null;
  const index = store.indexAtTime(ms);
  const segment = store.at(index);
  return segment && segment.startTime <= ms ? segment.id : null;
}
