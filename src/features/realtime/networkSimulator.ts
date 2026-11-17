/**
 * Development-only network simulation for the Live Feed connection.
 *
 * It sits between the WebSocket and the event pipeline and holds back messages that have already
 * arrived, in order, to imitate a slow or unstable network; it can also cut the connection. It does
 * NOT throttle the computer's real internet connection or the socket itself — for genuine bandwidth
 * throttling use the browser's developer tools (Chrome: DevTools → Network → Throttling).
 *
 * Messages are never reordered or duplicated here (a real WebSocket runs over TCP, which keeps
 * order). Messages still held when the connection drops are discarded, as data in flight on a dead
 * connection would be; the server replays them after the reconnect.
 *
 * Off in production builds unless VITE_NETWORK_SIMULATION=true.
 */

export type NetworkCondition = "normal" | "slow" | "unstable" | "lost";

export const SIMULATION_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_NETWORK_SIMULATION === "true";

export interface SlowSettings {
  /** Extra time before each message arrives. */
  delayMs: number;
  /** Simulated transfer speed for message data. */
  bytesPerSecond: number;
}

export const SLOW_DELAYS = [500, 1_500, 3_000] as const;
export const SLOW_SPEEDS = [1_024, 4_096, 16_384] as const;

type Deliver = (raw: string, arrivedAt: number) => void;

interface Held {
  raw: string;
  arrivedAt: number;
  releaseAt: number;
  isEvent: boolean;
}

/** Above this many held messages the connection counts as overwhelmed: it drops and resumes, as the server does for slow clients. */
const MAX_HELD = 20_000;
const UNSTABLE_TICK_MS = 1_000;

export interface NetworkSimSnapshot {
  condition: NetworkCondition;
  slow: SlowSettings;
  /** Transcript messages that have arrived but are being held back by the simulation. */
  heldEvents: number;
  /** Unstable mode: delivery is momentarily stalled. */
  stalled: boolean;
  /** Messages discarded because the connection dropped while they were held (replayed by the server). */
  discardedInTransit: number;
  /** Brief interruptions caused by unstable mode. */
  interruptions: number;
}

export class NetworkSimulator {
  private condition: NetworkCondition = "normal";
  private slow: SlowSettings = { delayMs: 1_500, bytesPerSecond: 4_096 };
  private held: Held[] = [];
  private head = 0;
  private heldEvents = 0;
  private lastTxEnd = 0;
  private lastReleaseAt = 0;
  private stallUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unstableTimer: ReturnType<typeof setInterval> | null = null;
  private deliver: Deliver | null = null;
  private discardedInTransit = 0;
  private interruptions = 0;
  /** Asks the connection to drop for this long (unstable mode, or an overwhelmed slow link). */
  onDropRequest: ((outageMs: number) => void) | null = null;

  setCondition(next: NetworkCondition): void {
    this.condition = next;
    this.stallUntil = 0;
    if (next === "unstable") this.startUnstable();
    else this.stopUnstable();
    // Back to normal: whatever is held arrives now, still in order.
    if (next === "normal") {
      for (let i = this.head; i < this.held.length; i++)
        this.held[i]!.releaseAt = 0;
      this.lastReleaseAt = this.lastTxEnd = 0;
    }
    this.flush();
  }

  setSlow(settings: Partial<SlowSettings>): void {
    this.slow = { ...this.slow, ...settings };
  }

  /** Every received frame passes through here. */
  inbound(raw: string, arrivedAt: number, deliver: Deliver): void {
    this.deliver = deliver;
    if (this.condition === "normal" && this.pending() === 0)
      return deliver(raw, arrivedAt);
    const now = performance.now();
    let releaseAt = now;
    if (this.condition === "slow") {
      // Transfer at the simulated speed, one message after another, then the fixed delay.
      const txEnd =
        Math.max(now, this.lastTxEnd) +
        (raw.length / this.slow.bytesPerSecond) * 1000;
      this.lastTxEnd = txEnd;
      releaseAt = txEnd + this.slow.delayMs;
    } else if (this.condition === "unstable") {
      releaseAt = now + 80 + Math.random() * 400;
    }
    releaseAt = Math.max(releaseAt, this.lastReleaseAt); // never overtakes an earlier message
    this.lastReleaseAt = releaseAt;
    const isEvent = raw.startsWith('{"type":"event"');
    this.held.push({ raw, arrivedAt, releaseAt, isEvent });
    if (isEvent) this.heldEvents++;
    if (this.pending() > MAX_HELD) {
      this.onDropRequest?.(500);
      return;
    }
    this.schedule();
  }

  /** The socket closed: anything still held was "in flight" and is lost; the server will replay it. */
  dropInFlight(): void {
    for (let i = this.head; i < this.held.length; i++)
      if (this.held[i]!.isEvent) this.discardedInTransit++;
    this.held = [];
    this.head = 0;
    this.heldEvents = 0;
    this.lastTxEnd = this.lastReleaseAt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  snapshot(): NetworkSimSnapshot {
    return {
      condition: this.condition,
      slow: this.slow,
      heldEvents: this.heldEvents,
      stalled:
        this.condition === "unstable" && performance.now() < this.stallUntil,
      discardedInTransit: this.discardedInTransit,
      interruptions: this.interruptions,
    };
  }

  private pending(): number {
    return this.held.length - this.head;
  }

  private schedule(): void {
    if (this.timer || this.pending() === 0) return;
    const next = this.held[this.head]!;
    const wait = Math.max(
      0,
      Math.max(next.releaseAt, this.stallUntil) - performance.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  private flush(): void {
    const now = performance.now();
    if (now >= this.stallUntil) {
      while (
        this.head < this.held.length &&
        this.held[this.head]!.releaseAt <= now
      ) {
        const h = this.held[this.head++]!;
        if (h.isEvent) this.heldEvents--;
        this.deliver?.(h.raw, h.arrivedAt);
      }
      if (this.head > 1024 && this.head * 2 > this.held.length) {
        this.held = this.held.slice(this.head);
        this.head = 0;
      }
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule();
  }

  /** Unstable: short stalls (messages pile up, then arrive together) and occasional brief disconnects. */
  private startUnstable(): void {
    if (this.unstableTimer) return;
    this.unstableTimer = setInterval(() => {
      const now = performance.now();
      if (now < this.stallUntil) return;
      const roll = Math.random();
      if (roll < 0.07) {
        this.interruptions++;
        this.onDropRequest?.(1_500 + Math.random() * 2_000);
      } else if (roll < 0.3) {
        // Kept well under the connection's 5 s silence limit, so a stall alone does not force a reconnect.
        this.stallUntil = now + 1_000 + Math.random() * 2_500;
        this.flush();
      }
    }, UNSTABLE_TICK_MS);
  }

  private stopUnstable(): void {
    if (this.unstableTimer) clearInterval(this.unstableTimer);
    this.unstableTimer = null;
  }
}
