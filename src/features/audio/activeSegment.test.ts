import { describe, expect, it, vi } from 'vitest';
import { generateTranscript } from '../../../shared/transcriptGenerator.ts';
import { TranscriptStore } from '../transcript/TranscriptStore.ts';
import { resolveActiveSegmentId } from './activeSegment.ts';

describe('resolveActiveSegmentId', () => {
  const segments = generateTranscript(1_000);
  const store = new TranscriptStore(segments);

  it('returns the segment whose span contains the time', () => {
    const s = segments[400]!;
    expect(resolveActiveSegmentId(store, s.startTime)).toBe(s.id);
    expect(resolveActiveSegmentId(store, s.endTime - 1)).toBe(s.id);
  });

  it('keeps the previous segment active through the silence before the next one', () => {
    const a = segments[400]!;
    const b = segments[401]!;
    expect(b.startTime).toBeGreaterThan(a.endTime);
    expect(resolveActiveSegmentId(store, a.endTime + 1)).toBe(a.id);
    expect(resolveActiveSegmentId(store, b.startTime)).toBe(b.id);
  });

  it('returns null before the first segment and for an empty store', () => {
    expect(resolveActiveSegmentId(store, segments[0]!.startTime - 1)).toBeNull();
    expect(resolveActiveSegmentId(new TranscriptStore(), 5_000)).toBeNull();
  });

  it('uses binary search — about log2(n) record reads on 100K segments, not a scan', () => {
    const big = new TranscriptStore(generateTranscript(100_000));
    const spy = vi.spyOn(big, 'at');
    const target = big.at(73_421)!;
    spy.mockClear();
    expect(resolveActiveSegmentId(big, target.startTime + 10)).toBe(target.id);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(20);
  });
});
