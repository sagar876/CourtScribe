import type { TranscriptSegment } from '../../../shared/transcript.ts';

/** The string a segment is searched by (speaker + text), normalised once. */
export function searchKey(s: Pick<TranscriptSegment, 'speakerName' | 'text'>): string {
  return `${s.speakerName}\n${s.text}`.toLocaleLowerCase();
}

/** Substring search over pre-normalised keys; returns ascending match indices. */
export function searchKeys(keys: readonly string[], query: string): Int32Array {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return new Int32Array(0);
  const hits: number[] = [];
  for (let i = 0; i < keys.length; i++) if ((keys[i] as string).includes(q)) hits.push(i);
  return Int32Array.from(hits);
}

/** Binary search: does the sorted `matches` contain `index`? */
export function containsSorted(matches: Int32Array, index: number): boolean {
  let lo = 0;
  let hi = matches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = matches[mid] as number;
    if (v === index) return true;
    if (v < index) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
