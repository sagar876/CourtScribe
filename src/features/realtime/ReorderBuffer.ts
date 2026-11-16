export type PushResult = 'accepted' | 'duplicate' | 'stale';

export interface DrainResult<T> {
  ready: T[];
  /** Sequence numbers given up on (gap timeout or buffer pressure). */
  skipped: number;
}

/**
 * Restores sequence order. Items ahead of the expected sequence wait until the
 * gap fills, or until the gap is older than `gapTimeoutMs` / the buffer exceeds
 * `maxPending`, at which point the gap is skipped and counted.
 */
export class ReorderBuffer<T> {
  private pending = new Map<number, { item: T; at: number }>();
  private oldestPendingAt = Infinity;
  /** Items that arrived after an item with a higher sequence number (late arrivals). */
  outOfOrder = 0;
  private maxSeen: number;

  constructor(
    private nextSeq: number,
    private readonly gapTimeoutMs = 750,
    private readonly maxPending = 5_000,
  ) {
    this.maxSeen = nextSeq - 1;
  }

  get expected(): number {
    return this.nextSeq;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  reset(nextSeq: number): void {
    this.nextSeq = nextSeq;
    this.maxSeen = nextSeq - 1;
    this.pending.clear();
    this.oldestPendingAt = Infinity;
  }

  push(seq: number, item: T, now: number): PushResult {
    if (seq < this.nextSeq) return 'stale';
    if (this.pending.has(seq)) return 'duplicate';
    if (seq < this.maxSeen) this.outOfOrder++;
    else this.maxSeen = seq;
    if (seq > this.nextSeq && this.pending.size === 0) this.oldestPendingAt = now;
    this.pending.set(seq, { item, at: now });
    return 'accepted';
  }

  drain(now: number): DrainResult<T> {
    const ready: T[] = [];
    let skipped = 0;
    for (;;) {
      let entry = this.pending.get(this.nextSeq);
      while (entry) {
        ready.push(entry.item);
        this.pending.delete(this.nextSeq);
        this.nextSeq++;
        entry = this.pending.get(this.nextSeq);
      }
      if (this.pending.size === 0) {
        this.oldestPendingAt = Infinity;
        break;
      }
      const gapExpired = now - this.oldestPendingAt >= this.gapTimeoutMs;
      if (!gapExpired && this.pending.size <= this.maxPending) break;
      let min = Infinity;
      for (const seq of this.pending.keys()) if (seq < min) min = seq;
      skipped += min - this.nextSeq;
      this.nextSeq = min;
      let oldestAt = Infinity;
      for (const v of this.pending.values()) if (v.at < oldestAt) oldestAt = v.at;
      this.oldestPendingAt = oldestAt;
    }
    return { ready, skipped };
  }
}
