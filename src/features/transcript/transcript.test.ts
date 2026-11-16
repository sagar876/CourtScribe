import { describe, expect, it } from 'vitest';
import { generateTranscript } from '../../../shared/transcriptGenerator.ts';
import { TranscriptStore } from './TranscriptStore.ts';
import { containsSorted, searchKey, searchKeys } from './searchCore.ts';
import { parseTimestamp, formatTimestamp } from '../../lib/format.ts';
import { percentileSorted, SampleWindow } from '../../lib/stats.ts';

describe('generateTranscript', () => {
  it('is deterministic, ordered and well-formed', () => {
    const a = generateTranscript(500);
    const b = generateTranscript(500);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.startTime).toBeGreaterThan(a[i - 1]!.endTime);
      expect(a[i]!.sequenceNumber).toBe(i + 1);
    }
    expect(new Set(a.map((s) => s.id)).size).toBe(500);
  });
});

describe('TranscriptStore', () => {
  it('appends in place, ignores duplicate ids and notifies', () => {
    const segs = generateTranscript(10);
    const store = new TranscriptStore(segs.slice(0, 5));
    let notified = 0;
    let appended = 0;
    store.subscribe(() => notified++);
    store.onAppend((added) => (appended += added.length));
    const first = store.at(0);
    store.append(segs.slice(3)); // 3,4 are duplicates
    expect(store.size).toBe(10);
    expect(appended).toBe(5);
    expect(notified).toBe(1);
    expect(store.at(0)).toBe(first); // identity preserved for memoised rows
  });

  it('finds the segment at a timestamp by binary search', () => {
    const segs = generateTranscript(1_000);
    const store = new TranscriptStore(segs);
    const target = segs[637]!;
    expect(store.indexAtTime(target.startTime)).toBe(637);
    expect(store.indexAtTime(target.startTime + 1)).toBe(637);
    expect(store.indexAtTime(0)).toBe(0);
  });
});

describe('search', () => {
  it('matches speaker or text case-insensitively and returns sorted indices', () => {
    const segs = generateTranscript(2_000);
    const keys = segs.map(searchKey);
    const hits = searchKeys(keys, 'exhibit p3');
    expect(hits.length).toBeGreaterThan(0);
    for (const i of hits) expect(keys[i]).toContain('exhibit p3');
    expect(Array.from(hits)).toEqual([...hits].sort((x, y) => x - y));
    expect(containsSorted(hits, hits[0]!)).toBe(true);
    expect(containsSorted(hits, -1)).toBe(false);
    expect(searchKeys(keys, '   ').length).toBe(0);
  });
});

describe('format + stats', () => {
  it('parses and formats timestamps', () => {
    expect(parseTimestamp('01:02:03')).toBe(3_723_000);
    expect(parseTimestamp('2:30')).toBe(150_000);
    expect(parseTimestamp('45')).toBe(45_000);
    expect(parseTimestamp('1:xx')).toBeNull();
    expect(formatTimestamp(3_723_400, true)).toBe('01:02:03.4');
  });

  it('computes nearest-rank percentiles over a window', () => {
    expect(percentileSorted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentileSorted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    const w = new SampleWindow(3);
    [100, 1, 2, 3].forEach((v) => w.add(v));
    expect(w.percentiles(50, 100)).toEqual([2, 3]);
  });
});
