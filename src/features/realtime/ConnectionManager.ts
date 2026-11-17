import type { ClientMessage, ServerConfig, ServerMessage, ServerStats, SpeechInput, TranscriptEvent } from '../../../shared/protocol.ts';
import { trackResource } from '../../lib/resources.ts';
import { backoffCeiling, backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff.ts';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'syncing';

export type HelloMessage = Extract<ServerMessage, { type: 'hello' }>;

export interface ConnectionHandlers {
  /** Raw ingestion: called once per event frame with the receive time. Must be cheap. */
  onEvent: (event: TranscriptEvent, receivedAt: number) => void;
  /** Session handshake; returns the last sequence number the client has already processed. */
  onHello: (hello: HelloMessage) => number;
}

export interface ConnectionSnapshot {
  state: ConnectionState;
  sessionId: string | null;
  lastError: string | null;
  framesReceived: number;
  bytesReceived: number;
  disconnects: number;
  reconnectAttempts: number;
  currentAttempt: number;
  nextRetryAt: number | null;
  nextRetryCeilingMs: number | null;
  lastReconnectMs: number | null;
  syncTargetSeq: number | null;
  offlineUntil: number;
  lastAckSent: number;
  server: ServerStats | null;
}

const ACK_INTERVAL_MS = 200;
/** Socket opened but no hello within this time → treat as failed attempt. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;
/** The server sends stats every second; this much silence means the socket is dead even without a close event. */
export const STALE_CONNECTION_MS = 5_000;

/**
 * Owns the WebSocket and nothing else: lifecycle, handshake/resume, ACKs,
 * exponential backoff with full jitter, and simulated outages. It knows
 * nothing about React or the transcript — events are passed straight to
 * `handlers.onEvent`.
 */
export class ConnectionManager {
  private ws: WebSocket | null = null;
  private releaseSocket: (() => void) | null = null;
  private wantConnected = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private releaseAckTimer: (() => void) | null = null;
  private disconnectedAt: number | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private processedSeq = 0;
  private listeners = new Set<() => void>();

  readonly clientId = crypto.randomUUID();
  readonly s: ConnectionSnapshot = {
    state: 'disconnected', sessionId: null, lastError: null, framesReceived: 0, bytesReceived: 0, disconnects: 0,
    reconnectAttempts: 0, currentAttempt: 0, nextRetryAt: null, nextRetryCeilingMs: null, lastReconnectMs: null,
    syncTargetSeq: null, offlineUntil: 0, lastAckSent: 0, server: null,
  };

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
    private readonly backoff: BackoffOptions = DEFAULT_BACKOFF,
  ) {}

  /** State transitions (not per-event) are published immediately. */
  onStateChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  connect(): void {
    if (this.wantConnected) return;
    this.wantConnected = true;
    this.attempt = 0;
    this.startAcks();
    this.open('connecting');
  }

  disconnect(): void {
    this.wantConnected = false;
    this.clearRetry();
    this.clearHandshake();
    this.s.offlineUntil = 0;
    this.closeSocket(1000, 'client disconnect');
    this.stopAcks();
    this.setState('disconnected');
  }

  /** Drop the current socket and reconnect straight away (resumes from the last ACK). */
  reconnectNow(): void {
    if (!this.wantConnected) return this.connect();
    this.clearRetry();
    this.s.offlineUntil = 0;
    this.closeSocket(4001, 'manual reconnect');
    this.markDropped('Manual reconnect');
    this.attempt = 0;
    this.open('reconnecting');
  }

  /** Simulated network outage: reconnect attempts fail until `ms` has elapsed. */
  simulateOutage(ms: number): void {
    if (!this.wantConnected) return;
    this.s.offlineUntil = performance.now() + ms;
    this.closeSocket(4000, 'simulated outage');
    this.markDropped('Network outage (simulated)');
    this.scheduleRetry();
  }

  requestServerDrop(): void {
    this.send({ type: 'disconnect-me' });
  }

  configureServer(config: Partial<ServerConfig>): void {
    this.send({ type: 'config', config });
  }

  burst(count: number): void {
    this.send({ type: 'burst', count });
  }

  /** Sends recognised speech; false when the socket is not open (caller keeps it for later). */
  sendSpeech(speech: SpeechInput): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || (this.s.state !== 'connected' && this.s.state !== 'syncing')) return false;
    this.send({ type: 'speech', speech });
    return true;
  }

  /** Pipeline progress: drives ACKs and the syncing → connected transition. */
  setProcessedSeq(seq: number): void {
    this.processedSeq = seq;
    if (this.s.state === 'syncing' && this.s.syncTargetSeq !== null && seq >= this.s.syncTargetSeq) {
      this.s.syncTargetSeq = null;
      this.setState('connected');
    }
  }

  resetCounters(): void {
    this.s.framesReceived = this.s.bytesReceived = this.s.disconnects = this.s.reconnectAttempts = 0;
    this.s.lastReconnectMs = null;
  }

  // ---------- internals ----------

  private open(state: ConnectionState): void {
    this.setState(state);
    if (performance.now() < this.s.offlineUntil) {
      this.s.reconnectAttempts++;
      this.s.lastError = 'Network unavailable (simulated)';
      this.scheduleRetry();
      return;
    }
    if (state === 'reconnecting') this.s.reconnectAttempts++;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      // e.g. a malformed URL: report it and keep retrying with backoff rather than throwing into the UI.
      this.s.lastError = err instanceof Error ? err.message : String(err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.clearHandshake();
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      if (this.ws !== ws) return;
      this.closeSocket(4003, 'handshake timeout');
      this.s.lastError = 'Server did not complete the handshake';
      this.markDropped('Handshake timed out');
      this.scheduleRetry();
    }, HANDSHAKE_TIMEOUT_MS);
    this.releaseSocket = trackResource('websocket');
    ws.onopen = () => this.send({ type: 'hello', clientId: this.clientId });
    ws.onmessage = (e: MessageEvent<string>) => this.onFrame(e.data);
    ws.onerror = () => {
      this.s.lastError = `Cannot reach ${this.url}`;
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.detach();
      this.markDropped('Connection closed');
      this.scheduleRetry();
    };
  }

  private onFrame(raw: string): void {
    const receivedAt = performance.now();
    this.lastFrameAt = receivedAt;
    this.s.framesReceived++;
    this.s.bytesReceived += raw.length;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'event') this.handlers.onEvent(msg.event, receivedAt);
    else if (msg.type === 'stats') this.s.server = msg.stats;
    else this.onHello(msg);
  }

  private onHello(hello: HelloMessage): void {
    this.clearHandshake();
    const processed = this.handlers.onHello(hello);
    // A different server session: the previous server's stats no longer describe anything.
    if (this.s.sessionId !== hello.sessionId) this.s.server = null;
    this.s.sessionId = hello.sessionId;
    if (this.disconnectedAt !== null) {
      this.s.lastReconnectMs = Math.round(performance.now() - this.disconnectedAt);
      this.disconnectedAt = null;
    }
    this.attempt = 0;
    this.s.currentAttempt = 0;
    this.s.nextRetryCeilingMs = null;
    this.s.lastError = null;
    this.processedSeq = processed;
    // Missed events are being replayed: "syncing" until the pipeline has caught up to the head at handshake time.
    if (hello.resumed && hello.headSeq > processed) {
      this.s.syncTargetSeq = hello.headSeq;
      this.setState('syncing');
    } else {
      this.s.syncTargetSeq = null;
      this.setState('connected');
    }
  }

  private clearHandshake(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private markDropped(reason: string): void {
    this.clearHandshake();
    if (this.s.state === 'connected' || this.s.state === 'syncing') {
      this.s.disconnects++;
      this.disconnectedAt = performance.now();
      this.s.lastError = reason;
    }
    if (this.wantConnected) this.setState('reconnecting');
  }

  private scheduleRetry(): void {
    if (!this.wantConnected || this.retryTimer) return;
    const delay = backoffDelay(this.attempt, this.backoff);
    this.s.nextRetryCeilingMs = backoffCeiling(this.attempt, this.backoff);
    this.attempt++;
    this.s.currentAttempt = this.attempt;
    this.s.nextRetryAt = performance.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.s.nextRetryAt = null;
      if (this.wantConnected) this.open('reconnecting');
    }, delay);
    this.emit();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.s.nextRetryAt = null;
    this.s.nextRetryCeilingMs = null;
  }

  private startAcks(): void {
    if (this.ackTimer) return;
    this.ackTimer = setInterval(() => {
      const online = this.s.state === 'connected' || this.s.state === 'syncing';
      if (online && performance.now() - this.lastFrameAt > STALE_CONNECTION_MS) {
        this.closeSocket(4002, 'stale connection');
        this.markDropped(`No data from server for ${STALE_CONNECTION_MS / 1000} s`);
        this.scheduleRetry();
        return;
      }
      if (online && this.processedSeq > this.s.lastAckSent) {
        this.send({ type: 'ack', seq: this.processedSeq });
        this.s.lastAckSent = this.processedSeq;
      }
    }, ACK_INTERVAL_MS);
    this.releaseAckTimer = trackResource('interval');
  }

  private stopAcks(): void {
    if (this.ackTimer) clearInterval(this.ackTimer);
    this.ackTimer = null;
    this.releaseAckTimer?.();
    this.releaseAckTimer = null;
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private detach(): void {
    if (this.ws) this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
    this.ws = null;
    this.releaseSocket?.();
    this.releaseSocket = null;
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.ws;
    this.detach();
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(code, reason);
  }

  private setState(state: ConnectionState): void {
    if (this.s.state === state) return;
    this.s.state = state;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
