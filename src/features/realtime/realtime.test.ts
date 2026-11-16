import { describe, expect, it } from 'vitest';
import { BoundedQueue } from './BoundedQueue.ts';
import { LruSet } from './LruSet.ts';
import { ReorderBuffer } from './ReorderBuffer.ts';
import { backoffCeiling, backoffDelay } from './backoff.ts';

describe('BoundedQueue', () => {
  it('keeps FIFO order and evicts the oldest when full', () => {
    const q = new BoundedQueue<number>(3);
    expect(q.push(1)).toBeUndefined();
    q.push(2);
    q.push(3);
    expect(q.push(4)).toBe(1);
    expect(q.size).toBe(3);
    expect(q.drain(2)).toEqual([2, 3]);
    q.push(5);
    expect(q.drain(10)).toEqual([4, 5]);
    expect(q.size).toBe(0);
  });
});

describe('LruSet', () => {
  it('detects duplicates and forgets the oldest keys beyond capacity', () => {
    const s = new LruSet(2);
    expect(s.checkAndAdd('a')).toBe(false);
    expect(s.checkAndAdd('a')).toBe(true);
    s.checkAndAdd('b');
    s.checkAndAdd('c');
    expect(s.checkAndAdd('a')).toBe(false); // evicted, so seen as new
  });
});

describe('ReorderBuffer', () => {
  it('releases items in sequence order', () => {
    const r = new ReorderBuffer<string>(1);
    r.push(2, 'b', 0);
    r.push(3, 'c', 0);
    expect(r.drain(0).ready).toEqual([]);
    r.push(1, 'a', 0);
    expect(r.drain(0)).toEqual({ ready: ['a', 'b', 'c'], skipped: 0 });
    expect(r.outOfOrder).toBe(1); // only seq 1 arrived after a higher seq
  });

  it('flags duplicates and stale sequence numbers', () => {
    const r = new ReorderBuffer<string>(1);
    r.push(2, 'b', 0);
    expect(r.push(2, 'b', 0)).toBe('duplicate');
    r.push(1, 'a', 0);
    r.drain(0);
    expect(r.push(1, 'a', 0)).toBe('stale');
  });

  it('skips a gap after the timeout and counts it', () => {
    const r = new ReorderBuffer<string>(1, 100);
    r.push(4, 'd', 0);
    expect(r.drain(50).ready).toEqual([]);
    expect(r.drain(100)).toEqual({ ready: ['d'], skipped: 3 });
    expect(r.expected).toBe(5);
  });

  it('skips a gap immediately under buffer pressure', () => {
    const r = new ReorderBuffer<number>(1, 10_000, 2);
    r.push(5, 5, 0);
    r.push(6, 6, 0);
    r.push(7, 7, 0);
    expect(r.drain(0)).toEqual({ ready: [5, 6, 7], skipped: 4 });
  });
});

describe('backoff', () => {
  it('grows exponentially up to the cap', () => {
    const opts = { baseMs: 100, maxMs: 1_000 };
    expect([0, 1, 2, 3, 4, 10].map((a) => backoffCeiling(a, opts))).toEqual([100, 200, 400, 800, 1_000, 1_000]);
  });

  it('applies full jitter within [0, ceiling]', () => {
    const opts = { baseMs: 100, maxMs: 1_000 };
    expect(backoffDelay(3, opts, () => 0)).toBe(0);
    expect(backoffDelay(3, opts, () => 0.5)).toBe(400);
    expect(backoffDelay(3, opts, () => 0.999999)).toBeLessThanOrEqual(800);
  });
});
