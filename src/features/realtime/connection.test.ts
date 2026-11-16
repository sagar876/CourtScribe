import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../../shared/protocol.ts';
import { ConnectionManager, HANDSHAKE_TIMEOUT_MS, STALE_CONNECTION_MS } from './ConnectionManager.ts';

/** Minimal controllable WebSocket double. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  // test helpers
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  hello(over: Partial<Extract<ServerMessage, { type: 'hello' }>> = {}) {
    this.receive({ type: 'hello', sessionId: 's1', serverTime: 0, startSeq: 1, headSeq: 0, resumed: false, unrecoverable: 0, ...over });
  }
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1]!;

describe('ConnectionManager reconnection', () => {
  let processed = 0;
  let manager: ConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.all = [];
    processed = 0;
    manager = new ConnectionManager('ws://test', { onEvent: () => {}, onHello: () => processed });
  });

  afterEach(() => {
    manager.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects, identifies itself and becomes connected on hello', () => {
    manager.connect();
    expect(manager.s.state).toBe('connecting');
    last().accept();
    expect(last().sent[0]).toEqual({ type: 'hello', clientId: manager.clientId });
    last().hello();
    expect(manager.s.state).toBe('connected');
  });

  it('reconnects after a drop using backoff with jitter, then syncs and resumes', () => {
    manager.connect();
    last().accept();
    last().hello({ headSeq: 10, startSeq: 11 });
    processed = 10;
    manager.setProcessedSeq(10);

    last().drop();
    expect(manager.s.state).toBe('reconnecting');
    expect(manager.s.disconnects).toBe(1);
    // attempt 0: ceiling 250 ms, random 0.5 → 125 ms
    vi.advanceTimersByTime(124);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);

    // Server replays missed events: "syncing" until the pipeline reaches the head seen at handshake.
    last().accept();
    expect(last().sent[0]).toEqual({ type: 'hello', clientId: manager.clientId }); // same identity → server resumes
    last().hello({ resumed: true, startSeq: 11, headSeq: 40 });
    expect(manager.s.state).toBe('syncing');
    manager.setProcessedSeq(39);
    expect(manager.s.state).toBe('syncing');
    manager.setProcessedSeq(40);
    expect(manager.s.state).toBe('connected');
    expect(manager.s.lastReconnectMs).toBe(125);
  });

  it('grows the backoff ceiling exponentially and caps it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    manager.connect();
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = FakeSocket.all.length;
      last().drop(); // fails before the handshake
      let waited = 0;
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(1);
        waited++;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    expect(manager.s.disconnects).toBe(0); // never got past the handshake
  });

  it('does not reconnect after an intentional disconnect', () => {
    manager.connect();
    last().accept();
    last().hello();
    manager.disconnect();
    expect(manager.s.state).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('keeps failing attempts during a simulated outage, then reconnects', () => {
    manager.connect();
    last().accept();
    last().hello();
    manager.simulateOutage(3_000);
    expect(manager.s.state).toBe('reconnecting');
    vi.advanceTimersByTime(2_900);
    expect(FakeSocket.all).toHaveLength(1); // no real sockets opened while "offline"
    expect(manager.s.reconnectAttempts).toBeGreaterThan(0);
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all.length).toBeGreaterThan(1);
  });

  it('gives up on a socket that never completes the handshake', () => {
    manager.connect();
    last().accept(); // open, but the server never says hello
    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);
    expect(manager.s.state).toBe('reconnecting');
    expect(manager.s.lastError).toMatch(/handshake/i);
    vi.advanceTimersByTime(250);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('detects a silently dead connection and reconnects', () => {
    manager.connect();
    last().accept();
    last().hello();
    vi.advanceTimersByTime(STALE_CONNECTION_MS + 300); // no frames, no close event
    expect(manager.s.state).toBe('reconnecting');
    expect(manager.s.disconnects).toBe(1);
  });

  it('acknowledges processed sequence numbers while connected', () => {
    manager.connect();
    last().accept();
    last().hello();
    manager.setProcessedSeq(42);
    vi.advanceTimersByTime(200);
    expect(last().sent).toContainEqual({ type: 'ack', seq: 42 });
  });

  it('reports a malformed URL instead of throwing', () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new SyntaxError('Invalid URL');
        }
      },
    );
    expect(() => manager.connect()).not.toThrow();
    expect(manager.s.lastError).toMatch(/Invalid URL/);
    expect(manager.s.state).toBe('connecting');
  });
});
