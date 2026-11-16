import type { TranscriptEvent } from '../../../shared/protocol.ts';
import { RateMeter, SampleWindow } from '../../lib/stats.ts';
import { BoundedQueue } from './BoundedQueue.ts';
import { LruSet } from './LruSet.ts';
import { ReorderBuffer } from './ReorderBuffer.ts';

export interface Queued {
  event: TranscriptEvent;
  receivedAt: number;
}

export interface PipelineOptions {
  /** Batching window: events received within it are applied in one store update. */
  windowMs: number;
  queueCapacity: number;
  maxBatch: number;
  dedupeCapacity: number;
  gapTimeoutMs: number;
}

export const DEFAULT_PIPELINE: PipelineOptions = { windowMs: 50, queueCapacity: 5_000, maxBatch: 2_000, dedupeCapacity: 60_000, gapTimeoutMs: 750 };

export type BatchSink = (batch: Queued[]) => void;

export interface PipelineCounters {
  received: number;
  processed: number;
  /** Same eventId seen again (injected duplicates, resume replays). */
  duplicateById: number;
  /** New eventId but its sequence number is already waiting in the reorder buffer. */
  duplicateBySeq: number;
  /** Sequence number at or below the processed watermark — already applied or given up on. */
  stale: number;
  outOfOrder: number;
  replayDuplicates: number;
  queueDropped: number;
  gapsSkipped: number;
  maxQueueDepth: number;
  batches: number;
  lastBatchSize: number;
  batchedEvents: number;
}

const zero = (): PipelineCounters => ({
  received: 0, processed: 0, duplicateById: 0, duplicateBySeq: 0, stale: 0, outOfOrder: 0, replayDuplicates: 0,
  queueDropped: 0, gapsSkipped: 0, maxQueueDepth: 0, batches: 0, lastBatchSize: 0, batchedEvents: 0,
});

/**
 * Event processing, independent of sockets and React:
 *   ingest → dedupe (eventId) → bounded queue → [batching window] →
 *   reorder/dedupe (sequenceNumber) → one sink call per batch.
 * `ingest` does O(1) work so socket handling never waits on processing.
 */
export class EventPipeline {
  private queue: BoundedQueue<Queued>;
  private seen: LruSet;
  private reorder: ReorderBuffer<Queued>;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProcessed = 0;
  private outOfOrderBase = 0;
  readonly c: PipelineCounters = zero();
  readonly processingLatency = new SampleWindow(4_000);
  readonly inMeter = new RateMeter(performance.now());
  readonly outMeter = new RateMeter(performance.now());
  private progress: (seq: number) => void = () => {};

  constructor(
    private readonly sink: BatchSink,
    private opts: PipelineOptions = DEFAULT_PIPELINE,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.queue = new BoundedQueue(opts.queueCapacity);
    this.seen = new LruSet(opts.dedupeCapacity);
    this.reorder = new ReorderBuffer(1, opts.gapTimeoutMs, opts.queueCapacity);
  }

  get windowMs(): number {
    return this.opts.windowMs;
  }

  get queueDepth(): number {
    return this.queue.size;
  }

  get pendingReorder(): number {
    return this.reorder.pendingCount;
  }

  get lastProcessedSeq(): number {
    return this.lastProcessed;
  }

  onProgress(fn: (seq: number) => void): void {
    this.progress = fn;
  }

  /** Changing the window clears latency samples so percentiles describe the current setting only. */
  setWindow(ms: number): void {
    this.opts = { ...this.opts, windowMs: Math.max(1, ms) };
    this.processingLatency.clear();
  }

  /**
   * Handshake with a (possibly new) server session. Returns the processed
   * watermark so the connection layer can decide whether it is syncing.
   */
  startSession(startSeq: number, sameSession: boolean, unrecoverable: number): number {
    if (!sameSession) {
      this.seen.clear();
      this.queue.clear();
      this.lastProcessed = startSeq - 1;
      this.reorder.reset(startSeq);
    } else {
      this.c.gapsSkipped += unrecoverable;
      // Never move backwards: replays at or below the watermark are duplicates.
      this.reorder.reset(Math.max(startSeq, this.lastProcessed + 1));
      if (startSeq > this.lastProcessed + 1) this.lastProcessed = startSeq - 1;
    }
    return this.lastProcessed;
  }

  /** Hot path — called for every socket frame carrying an event. */
  ingest(event: TranscriptEvent, receivedAt: number): void {
    this.c.received++;
    this.inMeter.add(1, receivedAt);
    if (this.seen.checkAndAdd(event.eventId)) {
      this.c.duplicateById++;
      if (event.replay) this.c.replayDuplicates++;
      return;
    }
    if (this.queue.push({ event, receivedAt })) this.c.queueDropped++;
    if (this.queue.size > this.c.maxQueueDepth) this.c.maxQueueDepth = this.queue.size;
    this.schedule(this.opts.windowMs);
  }

  /** Periodic housekeeping: releases sequence gaps that have timed out. */
  tick(): void {
    this.flush();
  }

  /** Apply everything now (used on disconnect / tests). */
  flushAll(): void {
    while (this.queue.size > 0) this.flush();
    this.flush();
  }

  private schedule(delay: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
      // Backlog larger than one batch: keep draining, but yield to the event loop (and React) between batches.
      if (this.queue.size > 0) this.schedule(0);
    }, delay);
  }

  private flush(): void {
    const items = this.queue.drain(this.opts.maxBatch);
    const t = this.now();
    for (const item of items) {
      const seq = item.event.sequenceNumber;
      const r = this.reorder.push(seq, item, t);
      if (r === 'stale') {
        this.c.stale++;
      } else if (r === 'duplicate') {
        this.c.duplicateBySeq++;
      }
    }
    const { ready, skipped } = this.reorder.drain(t);
    this.c.outOfOrder = this.reorder.outOfOrder - this.outOfOrderBase;
    this.c.gapsSkipped += skipped;
    if (ready.length > 0) {
      this.sink(ready);
      const done = this.now();
      for (const q of ready) this.processingLatency.add(done - q.receivedAt);
      this.c.processed += ready.length;
      this.outMeter.add(ready.length, done);
      this.c.batches++;
      this.c.lastBatchSize = ready.length;
      this.c.batchedEvents += ready.length;
      this.lastProcessed = (ready[ready.length - 1] as Queued).event.sequenceNumber;
    }
    if (skipped > 0) this.lastProcessed = Math.max(this.lastProcessed, this.reorder.expected - 1);
    if (ready.length > 0 || skipped > 0) this.progress(this.lastProcessed);
  }

  resetCounters(): void {
    Object.assign(this.c, zero());
    this.outOfOrderBase = this.reorder.outOfOrder;
    this.processingLatency.clear();
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
}
