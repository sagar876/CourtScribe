import { useSyncExternalStore } from "react";
import {
  STREAM_PORT,
  type ServerConfig,
  type ServerStats,
  type SpeechInput,
  type TranscriptEvent,
} from "../../../shared/protocol.ts";
import {
  SPEAKERS,
  type TranscriptSegment,
} from "../../../shared/transcript.ts";
import { trackResource } from "../../lib/resources.ts";
import { TranscriptStore } from "../transcript/TranscriptStore.ts";
import {
  ConnectionManager,
  type ConnectionState,
} from "./ConnectionManager.ts";
import {
  DEFAULT_PIPELINE,
  EventPipeline,
  type Queued,
} from "./EventPipeline.ts";
import {
  parseSpeech,
  SpeechEventBuilder,
} from "../../../shared/speechEvents.ts";
import { RenderLatencyTracker } from "./RenderLatencyTracker.ts";
import { DEFAULT_BACKOFF } from "./backoff.ts";
import {
  NetworkSimulator,
  SIMULATION_ENABLED,
  type NetworkCondition,
  type NetworkSimSnapshot,
  type SlowSettings,
} from "./networkSimulator.ts";

export type { ConnectionState };
export const BATCH_WINDOWS = [16, 50, 100, 250] as const;
export const QUEUE_CAPACITY = DEFAULT_PIPELINE.queueCapacity;
const PUBLISH_MS = 250;
const RECENT_DELAY_WINDOW_MS = 4_000;

export interface LiveSnapshot {
  state: ConnectionState;
  sessionId: string | null;
  lastError: string | null;
  /** Set when the configured Live Feed server address cannot work from this page. */
  configError: string | null;
  /** No Live Feed server configured: recognised speech is processed in this browser. */
  localMode: boolean;
  /** Speech results waiting for the socket to connect. */
  speechOutbox: number;
  sessionRestarted: boolean;
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
  // Connection & Reliability page
  /** Simulated network (development builds only); null when simulation is not available. */
  network: NetworkSimSnapshot | null;
  /** ms since the last transcript update was shown; null before the first. */
  lastShownAgoMs: number | null;
  /** Median time from a message reaching this browser to it being shown, over the last few seconds. */
  recentDelayMs: number | null;
  /** Server replay window requested from this page (0 = full buffer). */
  replayLimit: number;
  /** Transcript messages arrived and not yet shown (simulated hold-back + processing queue). */
  waiting: number;
  recovery: RecoveryReport | null;
}

/** What happened to messages sent while the connection was down (from the server's resume handshake). */
export interface RecoveryReport {
  at: number;
  /** Messages produced after the last one this browser had processed. */
  missed: number;
  /** Older than the server keeps, so they cannot be sent again. */
  unrecoverable: number;
  /** Replays this browser already had, ignored instead of shown twice. */
  duplicatesIgnored: number;
  done: boolean;
}

export function toSegment(
  e: TranscriptEvent,
  idPrefix = "",
): TranscriptSegment {
  return {
    id: idPrefix + e.segmentId,
    speakerId: e.speakerId,
    speakerName: SPEAKERS[e.speakerId],
    text: e.text,
    startTime: e.startTime,
    endTime: e.endTime,
    confidence: e.confidence,
    sequenceNumber: e.sequenceNumber,
    isPartial: e.eventType === "segment.partial",
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
  /** Only what was spoken into the microphone — the Courtroom transcript. Sample/test dialogue never goes here. */
  readonly speechStore = new TranscriptStore();
  private readonly pipeline: EventPipeline;
  private readonly connection: ConnectionManager;
  private readonly renderLatency: RenderLatencyTracker;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private releaseTimer: (() => void) | null = null;
  private snapshot: LiveSnapshot;
  /** Set when the server came back as a new session and the transcript was restarted. */
  private sessionRestarted = false;
  /** Latest result per utterance, kept while the socket is not connected (interims superseded, bounded). */
  private outbox = new Map<string, SpeechInput>();
  private configError: string | null = null;
  /** Local mode: the browser plays the server's role, using the same shared event builder. */
  private readonly localMode: boolean;
  private localSeq = 0;
  private localStarted = false;
  private readonly localEvents = new SpeechEventBuilder("local", Date.now());
  readonly network: NetworkSimulator | null = SIMULATION_ENABLED
    ? new NetworkSimulator()
    : null;
  private lastShownAt: number | null = null;
  /** [shownAt, delay] for updates shown in the last few seconds. */
  private recentDelays: [number, number][] = [];
  private replayLimitRequested: number | null = null;
  private recovery: RecoveryReport | null = null;
  private recoveryDupBase = 0;
  /** Segments whose latest update was a replay after a reconnect (bounded). */
  readonly recoveredSegments = new Set<string>();
  /** Sample hearing requested on the server (sent once connected). */
  private wantSample: boolean | null = null;

  constructor(url: string | null, configError: string | null) {
    this.configError = configError;
    this.localMode = url === null && configError === null;
    this.renderLatency = new RenderLatencyTracker(this.store);
    this.pipeline = new EventPipeline((batch) => this.apply(batch));
    this.connection = new ConnectionManager(
      url ?? "ws://invalid.localhost",
      {
        onEvent: (event, receivedAt) => this.pipeline.ingest(event, receivedAt),
        onHello: (hello) => {
          const previous = this.connection.s.sessionId;
          const sameSession = previous === hello.sessionId;
          // The server restarted: its sequence numbers, segment ids and timeline start over. Mixing two
          // sessions in one transcript would overwrite segments and break time ordering, so start fresh.
          if (previous !== null && !sameSession) {
            this.store.clear();
            this.speechStore.clear();
            this.sessionRestarted = true;
          }
          const before = this.pipeline.lastProcessedSeq;
          const startedAt = this.pipeline.startSession(
            hello.startSeq,
            sameSession,
            hello.unrecoverable,
          );
          if (hello.resumed && sameSession) {
            const missed = Math.max(0, hello.headSeq - before);
            if (missed > 0) {
              this.recovery = {
                at: Date.now(),
                missed,
                unrecoverable: hello.unrecoverable,
                duplicatesIgnored: 0,
                done: false,
              };
              this.recoveryDupBase =
                this.pipeline.c.duplicateById + this.pipeline.c.duplicateBySeq;
            }
          }
          return startedAt;
        },
      },
      DEFAULT_BACKOFF,
      this.network,
    );
    if (this.network)
      this.network.onDropRequest = (ms) => this.connection.simulateOutage(ms);
    this.pipeline.onProgress((seq) => this.connection.setProcessedSeq(seq));
    this.connection.onStateChange(() => {
      if (this.connection.s.state === "connected") {
        if (this.recovery && !this.recovery.done) this.recovery.done = true;
        if (this.wantSample !== null)
          this.connection.configureServer({
            running: this.wantSample,
            rate: 5,
          });
      }
      this.flushOutbox();
      this.publish();
    });
    this.snapshot = this.build();
  }

  private apply(batch: Queued[]): void {
    const segments = new Array<TranscriptSegment>(batch.length);
    const receivedAt = new Array<number>(batch.length);
    for (let i = 0; i < batch.length; i++) {
      const q = batch[i] as Queued;
      segments[i] = toSegment(q.event);
      receivedAt[i] = q.receivedAt;
      if (q.event.replay) this.recoveredSegments.add(segments[i]!.id);
      else this.recoveredSegments.delete(segments[i]!.id);
    }
    if (this.recoveredSegments.size > 5_000) this.recoveredSegments.clear();
    const now = performance.now();
    this.lastShownAt = now;
    for (const t of receivedAt) this.recentDelays.push([now, now - t]);
    this.trimDelays(now);
    if (this.recovery && !this.recovery.done)
      this.recovery.duplicatesIgnored =
        this.pipeline.c.duplicateById +
        this.pipeline.c.duplicateBySeq -
        this.recoveryDupBase;
    this.store.upsert(segments); // one store notification per batch
    const spoken = segments.filter((seg) => seg.speakerId === 'mic');
    if (spoken.length > 0) this.speechStore.upsert(spoken);
    this.renderLatency.expect(receivedAt);
  }

  // ---------- actions ----------
  connect = () => {
    if (this.configError || this.localMode) return this.publish();
    this.connection.connect();
    this.ensureTimer();
  };

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.pipeline.tick();
      this.publish();
    }, PUBLISH_MS);
    this.releaseTimer = trackResource("interval");
  }

  /** Local mode: assign sequence numbers here and feed the same pipeline the server's events go through. */
  private publishLocally(raw: SpeechInput): void {
    const speech = parseSpeech(raw);
    if (!speech) return;
    if (!this.localStarted) {
      this.pipeline.startSession(1, false, 0);
      this.localStarted = true;
      this.ensureTimer();
    }
    const seq = ++this.localSeq;
    const event: TranscriptEvent = {
      ...this.localEvents.build("browser", speech),
      eventId: `local:${seq}`,
      sequenceNumber: seq,
      timestamp: Date.now(),
      replay: false,
    };
    this.pipeline.ingest(event, performance.now());
  }

  disconnect = () => {
    this.connection.disconnect();
    this.pipeline.flushAll();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.releaseTimer?.();
    this.releaseTimer = null;
    this.publish();
  };

  /**
   * Publishes recognised speech through the server (which assigns IDs, sequence numbers and timestamps)
   * so it reaches the transcript via the same pipeline as every other event. Connects if needed.
   */
  publishSpeech = (speech: SpeechInput) => {
    if (this.configError) return;
    if (this.localMode) return this.publishLocally(speech);
    if (this.connection.s.state === "disconnected") this.connect();
    if (this.outbox.size === 0 && this.connection.sendSpeech(speech)) return;
    this.outbox.delete(speech.utteranceId); // keep order of latest updates
    this.outbox.set(speech.utteranceId, speech);
    while (this.outbox.size > 500)
      this.outbox.delete(this.outbox.keys().next().value!);
    this.flushOutbox();
    this.publish();
  };

  private flushOutbox(): void {
    for (const [id, speech] of this.outbox) {
      if (!this.connection.sendSpeech(speech)) return;
      this.outbox.delete(id);
    }
  }

  /** Simulated network condition (development builds). */
  setNetworkCondition = (next: NetworkCondition) => {
    if (!this.network) return;
    const prev = this.network.snapshot().condition;
    this.network.setCondition(next);
    if (next === "lost") this.connection.setNetworkLost(true);
    else if (prev === "lost") this.connection.setNetworkLost(false);
    this.publish();
  };
  setSlowNetwork = (settings: Partial<SlowSettings>) => {
    this.network?.setSlow(settings);
    this.publish();
  };
  /** Plays the server's made-up hearing through the real connection, at a readable pace. */
  get sampleRequested(): boolean {
    return this.wantSample === true;
  }
  setSampleHearing = (on: boolean) => {
    this.wantSample = on;
    if (on) this.connect();
    this.connection.configureServer({ running: on, rate: 5 });
    this.publish();
  };
  /** Server keeps only the last N messages for replay (0 = full buffer) — shows what happens after a long outage. */
  setReplayLimit = (limit: number) => {
    this.replayLimitRequested = limit;
    this.connection.configureServer({ replayLimit: limit });
    this.publish();
  };

  private trimDelays(now: number): void {
    let i = 0;
    while (i < this.recentDelays.length && now - this.recentDelays[i]![0] > RECENT_DELAY_WINDOW_MS) i++;
    if (i > 0) this.recentDelays.splice(0, i);
    if (this.recentDelays.length > 2_000) this.recentDelays.splice(0, this.recentDelays.length - 2_000);
  }

  private recentDelayMs(now: number): number | null {
    this.trimDelays(now);
    if (this.recentDelays.length === 0) return null;
    const sorted = this.recentDelays.map((d) => d[1]).sort((a, b) => a - b);
    return sorted[sorted.length >> 1]!;
  }
  reconnectNow = () => this.connection.reconnectNow();
  simulateOutage = (ms: number) => this.connection.simulateOutage(ms);
  requestServerDrop = () => this.connection.requestServerDrop();
  configureServer = (config: Partial<ServerConfig>) =>
    this.connection.configureServer(config);
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
  clearTranscript = () => {
    this.store.clear();
    this.recoveredSegments.clear();
    this.sessionRestarted = false;
    this.publish();
  };

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
    const [processingP50, processingP95] = p.processingLatency.percentiles(
      50,
      95,
    ) as [number, number];
    const [renderP50, renderP95] = this.renderLatency.samples.percentiles(
      50,
      95,
    ) as [number, number];
    return {
      state: s.state,
      sessionId: this.localMode ? "local" : s.sessionId,
      lastError: this.configError ?? s.lastError,
      configError: this.configError,
      localMode: this.localMode,
      speechOutbox: this.outbox.size,
      sessionRestarted: this.sessionRestarted,
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
      nextRetryInMs:
        s.nextRetryAt !== null
          ? Math.max(0, Math.round(s.nextRetryAt - now))
          : null,
      nextRetryCeilingMs: s.nextRetryCeilingMs,
      lastReconnectMs: s.lastReconnectMs,
      outageRemainingMs:
        s.offlineUntil > now ? Math.round(s.offlineUntil - now) : null,
      syncTargetSeq: s.syncTargetSeq,
      server: s.server,
      network: this.network?.snapshot() ?? null,
      lastShownAgoMs:
        this.lastShownAt === null ? null : Math.round(now - this.lastShownAt),
      recentDelayMs: this.recentDelayMs(now),
      replayLimit: this.replayLimitRequested ?? s.server?.config.replayLimit ?? 0,
      waiting:
        (this.network?.snapshot().heldEvents ?? 0) +
        p.queueDepth +
        p.pendingReorder,
      recovery: this.recovery ? { ...this.recovery } : null,
    };
  }
}

const isLocalHost =
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
  location.hostname.endsWith(".localhost");
/**
 * Live Feed server address: VITE_STREAM_URL when set; the local dev server on localhost. A deployed site
 * without VITE_STREAM_URL (or with VITE_STREAM_URL=local) runs in local mode: no server, speech processed in
 * the browser by the same shared code. Set VITE_STREAM_URL to a wss:// address to plug the server in.
 */
const configuredUrl = import.meta.env.VITE_STREAM_URL;
export const STREAM_URL: string | null =
  configuredUrl === "local"
    ? null
    : (configuredUrl ??
      (isLocalHost ? `ws://${location.hostname}:${STREAM_PORT}` : null));
const isWebSocketUrl = (u: string) => {
  try {
    return ["ws:", "wss:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
};
const STREAM_CONFIG_ERROR = !STREAM_URL
  ? null
  : !isWebSocketUrl(STREAM_URL)
    ? `VITE_STREAM_URL must be a ws:// or wss:// address (got “${STREAM_URL}”).`
    : location.protocol === "https:" && STREAM_URL.startsWith("ws://")
      ? "This page is served over HTTPS, so the Live Feed server must use a secure wss:// address (VITE_STREAM_URL)."
      : null;

/** App-wide singleton — a plain object, not React context. */
export const live = new LiveSession(STREAM_URL, STREAM_CONFIG_ERROR);
export const liveTranscript = live.store;
/** Microphone speech only (Courtroom). */
export const speechTranscript = live.speechStore;

export function useLiveSnapshot(): LiveSnapshot {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}
