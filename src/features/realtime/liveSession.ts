import { useSyncExternalStore } from 'react';
import { STREAM_PORT, type ServerConfig, type ServerStats, type TranscriptEvent } from '../../../shared/protocol.ts';
import { SPEAKERS, type TranscriptSegment } from '../../../shared/transcript.ts';
import { trackResource } from '../../lib/resources.ts';
import { TranscriptStore } from '../transcript/TranscriptStore.ts';
import { ConnectionManager, type ConnectionState } from './ConnectionManager.ts';
import { DEFAULT_PIPELINE, EventPipeline, type Queued } from './EventPipeline.ts';
import { RenderLatencyTracker } from './RenderLatencyTracker.ts';

export type { ConnectionState };
export const BATCH_WINDOWS = [16, 50, 100, 250] as const;
export const QUEUE_CAPACITY = DEFAULT_PIPELINE.queueCapacity;
const PUBLISH_MS = 250;

export interface LiveSnapshot {
  state: ConnectionState;
  sessionId: string | null;
  lastError: string | null;
  windowMs: number;
  // Throughput (browser-measured)
  incomingPerSecond: number;
  processedPerSecond: number;
  framesReceived: number;
  received: number;
  processed: number;
  // Integrity
  duplicates: number;
  duplicateById: number;
  duplicateBySeq: number;
  replayDuplicates: number;
  stale: number;
  outOfOrder: number;
  dropped: number;
  queueDropped: number;
  gapsSkipped: number;
  // Queue & batching
  queueDepth: number;
  maxQueueDepth: number;
  reorderPending: number;
  batches: number;
  lastBatchSize: number;
  avgBatchSize: number;
  // Latency (performance.now based)
  processingP50: number;
  processingP95: number;
  renderP50: number;
  renderP95: number;
  renderSamples: number;
  renderUnmeasured: number;
  // Resilience
  lastProcessedSeq: number;
  lastAckSent: number;
  disconnects: number;
  reconnectAttempts: number;
  currentAttempt: number;
  nextRetryInMs: number | null;
  nextRetryCeilingMs: number | null;
  lastReconnectMs: number | null;
  outageRemainingMs: number | null;
  syncTargetSeq: number | null;
  server: ServerStats | null;
}

function toSegment(e: TranscriptEvent): TranscriptSegment {
  return {
    id: e.segmentId,
    speakerId: e.speakerId,
    speakerName: SPEAKERS[e.speakerId],
    text: e.text,
    startTime: e.startTime,
    endTime: e.endTime,
    confidence: e.confidence,
    sequenceNumber: e.sequenceNumber,
    isPartial: e.eventType === 'segment.partial',
  };
}

/**
 * Composition root for the live feed. Three layers, each unaware of the next:
 *   ConnectionManager (socket)  →  EventPipeline (dedupe/queue/batch/order)  →  TranscriptStore (React reads)
 * React never sees individual messages: the store changes once per batch and
 * metrics are published as a snapshot at 4 Hz.
 */
class LiveSession {
  readonly store = new TranscriptStore();
  private readonly pipeline: EventPipeline;
  private readonly connection: ConnectionManager;
  private readonly renderLatency: RenderLatencyTracker;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private releaseTimer: (() => void) | null = null;
  private snapshot: LiveSnapshot;

  constructor(url: string) {
    this.renderLatency = new RenderLatencyTracker(this.store);
    this.pipeline = new EventPipeline((batch) => this.apply(batch));
    this.connection = new ConnectionManager(url, {
      onEvent: (event, receivedAt) => this.pipeline.ingest(event, receivedAt),
      onHello: (hello) => this.pipeline.startSession(hello.startSeq, this.connection.s.sessionId === hello.sessionId, hello.unrecoverable),
    });
    this.pipeline.onProgress((seq) => this.connection.setProcessedSeq(seq));
    this.connection.onStateChange(() => this.publish());
    this.snapshot = this.build();
  }

  private apply(batch: Queued[]): void {
    const segments = new Array<TranscriptSegment>(batch.length);
    const receivedAt = new Array<number>(batch.length);
    for (let i = 0; i < batch.length; i++) {
      const q = batch[i] as Queued;
      segments[i] = toSegment(q.event);
      receivedAt[i] = q.receivedAt;
    }
    this.store.upsert(segments); // one store notification per batch
    this.renderLatency.expect(receivedAt);
  }

  // ---------- actions ----------
  connect = () => {
    this.connection.connect();
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.pipeline.tick();
        this.publish();
      }, PUBLISH_MS);
      this.releaseTimer = trackResource('interval');
    }
  };

  disconnect = () => {
    this.connection.disconnect();
    this.pipeline.flushAll();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.releaseTimer?.();
    this.releaseTimer = null;
    this.publish();
  };

  reconnectNow = () => this.connection.reconnectNow();
  simulateOutage = (ms: number) => this.connection.simulateOutage(ms);
  requestServerDrop = () => this.connection.requestServerDrop();
  configureServer = (config: Partial<ServerConfig>) => this.connection.configureServer(config);
  burst = (count: number) => this.connection.burst(count);
  setWindow = (ms: number) => {
    this.pipeline.setWindow(ms);
    this.renderLatency.reset();
    this.publish();
  };
  resetCounters = () => {
    this.pipeline.resetCounters();
    this.connection.resetCounters();
    this.renderLatency.reset();
    this.publish();
  };
  clearTranscript = () => this.store.clear();

  // ---------- snapshot ----------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  private publish(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }

  private build(): LiveSnapshot {
    const now = performance.now();
    const p = this.pipeline;
    const c = p.c;
    const s = this.connection.s;
    p.inMeter.roll(now);
    p.outMeter.roll(now);
    const [processingP50, processingP95] = p.processingLatency.percentiles(50, 95) as [number, number];
    const [renderP50, renderP95] = this.renderLatency.samples.percentiles(50, 95) as [number, number];
    return {
      state: s.state,
      sessionId: s.sessionId,
      lastError: s.lastError,
      windowMs: p.windowMs,
      incomingPerSecond: p.inMeter.perSecond,
      processedPerSecond: p.outMeter.perSecond,
      framesReceived: s.framesReceived,
      received: c.received,
      processed: c.processed,
      duplicates: c.duplicateById + c.duplicateBySeq,
      duplicateById: c.duplicateById,
      duplicateBySeq: c.duplicateBySeq,
      replayDuplicates: c.replayDuplicates,
      stale: c.stale,
      outOfOrder: c.outOfOrder,
      dropped: c.queueDropped + c.gapsSkipped,
      queueDropped: c.queueDropped,
      gapsSkipped: c.gapsSkipped,
      queueDepth: p.queueDepth,
      maxQueueDepth: c.maxQueueDepth,
      reorderPending: p.pendingReorder,
      batches: c.batches,
      lastBatchSize: c.lastBatchSize,
      avgBatchSize: c.batches ? c.batchedEvents / c.batches : 0,
      processingP50,
      processingP95,
      renderP50,
      renderP95,
      renderSamples: this.renderLatency.samples.size,
      renderUnmeasured: this.renderLatency.unmeasured,
      lastProcessedSeq: p.lastProcessedSeq,
      lastAckSent: s.lastAckSent,
      disconnects: s.disconnects,
      reconnectAttempts: s.reconnectAttempts,
      currentAttempt: s.currentAttempt,
      nextRetryInMs: s.nextRetryAt !== null ? Math.max(0, Math.round(s.nextRetryAt - now)) : null,
      nextRetryCeilingMs: s.nextRetryCeilingMs,
      lastReconnectMs: s.lastReconnectMs,
      outageRemainingMs: s.offlineUntil > now ? Math.round(s.offlineUntil - now) : null,
      syncTargetSeq: s.syncTargetSeq,
      server: s.server,
    };
  }
}

const url = import.meta.env.VITE_STREAM_URL ?? `ws://${location.hostname}:${STREAM_PORT}`;

/** App-wide singleton — a plain object, not React context. */
export const live = new LiveSession(url);
export const liveTranscript = live.store;

export function useLiveSnapshot(): LiveSnapshot {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}
