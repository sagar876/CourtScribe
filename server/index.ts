/**
 * CourtScribe stream server — a lightweight, in-memory live transcript feed.
 *
 * - One shared "court session" stream; generation continues while clients are away,
 *   so reconnecting clients genuinely need to resume.
 * - Every event is its own WebSocket frame (so throughput numbers are real frames).
 * - Ring buffer of recent events enables resume from the last ACKed sequence number.
 * - Chaos controls: duplicates, out-of-order swaps, bursts, forced disconnects.
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { STREAM_PORT, STREAM_RATES, type ClientMessage, type ServerConfig, type ServerMessage, type TranscriptEvent } from '../shared/protocol.ts';
import { mulberry32, TranscriptGenerator } from '../shared/transcriptGenerator.ts';
import { expandSegment, type EventDraft } from '../shared/transcriptEvents.ts';

const BUFFER_CAPACITY = 50_000;
const MAX_BURST = 20_000;
const TICK_MS = 10;

interface StoredEvent extends EventDraft {
  eventId: string;
  sequenceNumber: number;
}

interface ClientState {
  ws: WebSocket;
  clientId: string | null;
  live: boolean;
  sent: number;
  /** Event held back to be sent after the next one (reorder injection). */
  held: StoredEvent | null;
}

const sessionId = randomUUID().slice(0, 8);
const generator = new TranscriptGenerator(2026);
const partialRng = mulberry32(7);
let segmentCounter = 0;
let pendingDrafts: EventDraft[] = [];
const ring: (StoredEvent | undefined)[] = new Array(BUFFER_CAPACITY);
const lastAckByClient = new Map<string, number>();
const clients = new Set<ClientState>();

const config: ServerConfig = { running: false, rate: 50, duplicateRate: 0, reorderRate: 0 };
let headSeq = 0;
let generatedTotal = 0;
let sentTotal = 0;
let sentThisSecond = 0;
let sendRateLastSecond = 0;
let duplicatesInjected = 0;
let reorderedInjected = 0;
let replayedTotal = 0;
let carry = 0;
let lastTick = performance.now();

const oldestBufferedSeq = () => Math.max(1, headSeq - BUFFER_CAPACITY + 1);

/** Next event: partial hypotheses for the current segment, then its final. */
function generate(): StoredEvent {
  if (pendingDrafts.length === 0) pendingDrafts = expandSegment(generator.next(++segmentCounter), partialRng);
  const draft = pendingDrafts.shift() as EventDraft;
  const seq = ++headSeq;
  const ev: StoredEvent = { ...draft, eventId: `${sessionId}:${seq}`, sequenceNumber: seq };
  ring[seq % BUFFER_CAPACITY] = ev;
  generatedTotal++;
  return ev;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function writeEvent(c: ClientState, ev: StoredEvent, replay: boolean): void {
  const event: TranscriptEvent = { ...ev, timestamp: Date.now(), replay };
  send(c.ws, { type: 'event', event });
  c.sent++;
  sentTotal++;
  sentThisSecond++;
}

/** Live delivery with optional chaos (duplicates + adjacent swaps). */
function deliverLive(c: ClientState, ev: StoredEvent): void {
  if (!c.live) return;
  if (c.held) {
    writeEvent(c, ev, false);
    writeEvent(c, c.held, false);
    c.held = null;
  } else if (config.reorderRate > 0 && Math.random() < config.reorderRate) {
    c.held = ev;
    reorderedInjected++;
    return;
  } else {
    writeEvent(c, ev, false);
  }
  if (config.duplicateRate > 0 && Math.random() < config.duplicateRate) {
    writeEvent(c, ev, false);
    duplicatesInjected++;
  }
}

/** Release any event held back for reordering so a paused stream leaves no gap. */
function flushHeld(): void {
  for (const c of clients) {
    if (c.held) {
      writeEvent(c, c.held, false);
      c.held = null;
    }
  }
}

function broadcastEvent(ev: StoredEvent): void {
  for (const c of clients) deliverLive(c, ev);
}

function tick(): void {
  const now = performance.now();
  const elapsed = now - lastTick;
  lastTick = now;
  if (!config.running) {
    carry = 0;
    return;
  }
  carry += (config.rate * elapsed) / 1000;
  const due = Math.floor(carry);
  carry -= due;
  for (let i = 0; i < due; i++) broadcastEvent(generate());
}

function handleHello(c: ClientState, clientId: string): void {
  c.clientId = clientId;
  const lastAck = lastAckByClient.get(clientId);
  const resumed = lastAck !== undefined;
  let startSeq = headSeq + 1;
  let unrecoverable = 0;
  if (resumed) {
    startSeq = lastAck + 1;
    const oldest = oldestBufferedSeq();
    if (startSeq < oldest && headSeq > 0) {
      unrecoverable = oldest - startSeq;
      startSeq = oldest;
    }
  } else {
    lastAckByClient.set(clientId, headSeq);
  }
  send(c.ws, { type: 'hello', sessionId, serverTime: Date.now(), startSeq, headSeq, resumed, unrecoverable });
  for (let seq = startSeq; seq <= headSeq; seq++) {
    const ev = ring[seq % BUFFER_CAPACITY];
    if (ev && ev.sequenceNumber === seq) {
      writeEvent(c, ev, true);
      replayedTotal++;
    }
  }
  c.live = true;
}

function handleMessage(c: ClientState, msg: ClientMessage): void {
  switch (msg.type) {
    case 'hello':
      handleHello(c, msg.clientId);
      break;
    case 'ack':
      if (c.clientId && Number.isFinite(msg.seq)) {
        const prev = lastAckByClient.get(c.clientId) ?? 0;
        if (msg.seq > prev) lastAckByClient.set(c.clientId, msg.seq);
      }
      break;
    case 'config': {
      const next = msg.config;
      if (typeof next.running === 'boolean') {
        config.running = next.running;
        if (!next.running) flushHeld();
      }
      if (next.rate !== undefined && (STREAM_RATES as readonly number[]).includes(next.rate)) config.rate = next.rate;
      if (typeof next.duplicateRate === 'number') config.duplicateRate = clamp01(next.duplicateRate);
      if (typeof next.reorderRate === 'number') config.reorderRate = clamp01(next.reorderRate);
      broadcastStats();
      break;
    }
    case 'burst': {
      const count = Math.min(MAX_BURST, Math.max(0, Math.floor(msg.count)));
      for (let i = 0; i < count; i++) broadcastEvent(generate());
      break;
    }
    case 'disconnect-me':
      // Hard close without a close handshake — looks like a dropped connection to the client.
      c.ws.terminate();
      break;
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function broadcastStats(): void {
  for (const c of clients) {
    send(c.ws, {
      type: 'stats',
      stats: {
        at: Date.now(),
        config: { ...config },
        headSeq,
        oldestBufferedSeq: oldestBufferedSeq(),
        bufferedEvents: Math.min(headSeq, BUFFER_CAPACITY),
        generatedTotal,
        sendRateLastSecond,
        sentTotal,
        duplicatesInjected,
        reorderedInjected,
        replayedTotal,
        clients: clients.size,
        you: c.clientId
          ? { lastAckedSeq: lastAckByClient.get(c.clientId) ?? 0, bufferedAmount: c.ws.bufferedAmount, sent: c.sent }
          : null,
      },
    });
  }
}

const wss = new WebSocketServer({ port: STREAM_PORT });

wss.on('connection', (ws) => {
  const c: ClientState = { ws, clientId: null, live: false, sent: 0, held: null };
  clients.add(c);
  ws.on('message', (raw) => {
    try {
      handleMessage(c, JSON.parse(String(raw)) as ClientMessage);
    } catch {
      // Ignore malformed frames; this is a local POC server.
    }
  });
  ws.on('close', () => clients.delete(c));
  ws.on('error', () => clients.delete(c));
});

const tickTimer = setInterval(tick, TICK_MS);
const statsTimer = setInterval(() => {
  sendRateLastSecond = sentThisSecond;
  sentThisSecond = 0;
  broadcastStats();
}, 1000);

wss.on('listening', () => {
  console.log(`[stream] CourtScribe stream server on ws://localhost:${STREAM_PORT} (session ${sessionId})`);
});

function shutdown(): void {
  clearInterval(tickTimer);
  clearInterval(statsTimer);
  for (const c of clients) c.ws.terminate();
  wss.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
