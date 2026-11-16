/** Nearest-rank percentile on an already-sorted array. */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

/** Fixed-size ring of numeric samples (no allocation per sample). */
export class SampleWindow {
  private buf: Float64Array;
  private idx = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  add(v: number): void {
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get size(): number {
    return this.count;
  }

  percentiles(...ps: number[]): number[] {
    const sorted = this.buf.slice(0, this.count).sort();
    return ps.map((p) => percentileSorted(sorted, p));
  }

  clear(): void {
    this.idx = 0;
    this.count = 0;
  }
}

/** Counts events in one-second buckets; `perSecond` is the last completed second. */
export class RateMeter {
  private current = 0;
  private bucketStart: number;
  perSecond = 0;

  constructor(now: number) {
    this.bucketStart = now;
  }

  add(n: number, now: number): void {
    this.roll(now);
    this.current += n;
  }

  roll(now: number): void {
    const elapsed = now - this.bucketStart;
    if (elapsed >= 1000) {
      this.perSecond = elapsed >= 2000 ? 0 : this.current;
      this.current = 0;
      this.bucketStart = now - (elapsed % 1000);
    }
  }
}
