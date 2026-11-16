import { describe, expect, it } from 'vitest';
import { generateTranscript } from '../../../shared/transcriptGenerator.ts';
import { TranscriptStore } from './TranscriptStore.ts';
import { searchKey, searchKeys } from './searchCore.ts';

describe('TranscriptStore indexing', () => {
  it('keeps id → position consistent across load, append, upsert and clear', () => {
    const [a, b, c, d] = generateTranscript(4);
    const store = new TranscriptStore([a!, b!]);
    expect(store.indexOf(a!.id)).toBe(0);
    expect(store.indexOf(b!.id)).toBe(1);
    store.append([c!]);
    expect(store.indexOf(c!.id)).toBe(2);
    store.upsert([{ ...b!, text: 'revised' }, d!]);
    expect(store.indexOf(b!.id)).toBe(1); // revision keeps its slot
    expect(store.at(1)!.text).toBe('revised');
    expect(store.indexOf(d!.id)).toBe(3);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.indexOf(a!.id)).toBe(-1);
  });

  it('handles a partial and its final for a new segment in the same batch', () => {
    const [s] = generateTranscript(1);
    const store = new TranscriptStore();
    const appended: string[] = [];
    store.onAppend((added) => appended.push(...added.map((x) => x.text)));
    store.upsert([{ ...s!, text: 'part', isPartial: true }, s!]);
    expect(store.size).toBe(1);
    expect(store.at(0)!.isPartial).toBeFalsy();
    expect(appended).toEqual([s!.text]); // listeners see the final record, once
  });

  it('indexAtTime finds the segment at or before a timestamp in 100K segments', () => {
    const segs = generateTranscript(100_000);
    const store = new TranscriptStore(segs);
    for (const i of [0, 1, 50_000, 99_998, 99_999]) {
      const s = segs[i]!;
      expect(store.indexAtTime(s.startTime)).toBe(i);
      expect(store.indexAtTime(s.endTime)).toBe(i);
    }
    expect(store.indexAtTime(Number.MAX_SAFE_INTEGER)).toBe(99_999);
    expect(new TranscriptStore().indexAtTime(1_000)).toBe(-1);
  });

  it('search keys index speaker and text, case-insensitively', () => {
    const store = new TranscriptStore(generateTranscript(5_000));
    const keys = Array.from({ length: store.size }, (_, i) => searchKey(store.at(i)!));
    const bySpeaker = searchKeys(keys, 'BENCH CLERK');
    expect(bySpeaker.length).toBeGreaterThan(0);
    for (const i of bySpeaker) expect(store.at(i)!.speakerName).toBe('Bench Clerk');
    const malayalam = searchKeys(keys, 'സാക്ഷി');
    for (const i of malayalam) expect(store.at(i)!.text).toContain('സാക്ഷി');
  });
});
