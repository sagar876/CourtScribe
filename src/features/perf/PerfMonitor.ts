import { trackResource } from '../../lib/resources.ts';

export interface PerfSample {
  /** Seconds since the monitor started. */
  t: number;
  fps: number;
  longTasks: number;
  blockingMs: number;
  heapMB: number | null;
  domNodes: number;
  extra: Record<string, number | null>;
}

export interface PerfState {
  history: PerfSample[];
  latest: PerfSample | null;
  totals: { longTasks: number; blockingMs: number; maxLongTaskMs: number };
  supported: { longtask: boolean; memory: boolean };
}

interface ChromeMemory {
  usedJSHeapSize: number;
}

const HISTORY = 60;

function readHeapMB(): number | null {
  const mem = (performance as Performance & { memory?: ChromeMemory }).memory;
  return mem ? mem.usedJSHeapSize / 1024 / 1024 : null;
}

/**
 * Samples real runtime behaviour once per second:
 * - FPS from requestAnimationFrame callbacks actually delivered
 * - Long tasks (>50 ms) from PerformanceObserver; blocking time = Σ(duration − 50)
 * - JS heap from performance.memory (Chromium only)
 * - DOM node count
 * plus caller-provided values (stream metrics, render rates).
 */
export class PerfMonitor {
  private state: PerfState;
  private listeners = new Set<() => void>();
  private disposers: (() => void)[] = [];
  private frames = 0;
  private secLongTasks = 0;
  private secBlocking = 0;
  private startedAt = 0;

  private sampleExtra: () => Record<string, number | null> = () => ({});

  constructor() {
    const longtask = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask');
    this.state = {
      history: [],
      latest: null,
      totals: { longTasks: 0, blockingMs: 0, maxLongTaskMs: 0 },
      supported: { longtask: Boolean(longtask), memory: readHeapMB() !== null },
    };
  }

  setSampler(fn: () => Record<string, number | null>): void {
    this.sampleExtra = fn;
  }

  start(): void {
    this.startedAt = performance.now();
    const tick = () => {
      this.frames++;
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    const releaseRaf = trackResource('raf-loop');
    this.disposers.push(() => {
      cancelAnimationFrame(raf);
      releaseRaf();
    });

    if (this.state.supported.longtask) {
      const obs = new PerformanceObserver((list) => {
        const t = this.state.totals;
        for (const e of list.getEntries()) {
          this.secLongTasks++;
          this.secBlocking += Math.max(0, e.duration - 50);
          t.longTasks++;
          t.blockingMs += Math.max(0, e.duration - 50);
          t.maxLongTaskMs = Math.max(t.maxLongTaskMs, e.duration);
        }
      });
      obs.observe({ type: 'longtask', buffered: false });
      const releaseObs = trackResource('observer');
      this.disposers.push(() => {
        obs.disconnect();
        releaseObs();
      });
    }

    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - last) / 1000;
      last = now;
      const sample: PerfSample = {
        t: Math.round((now - this.startedAt) / 1000),
        fps: Math.round(this.frames / elapsed),
        longTasks: this.secLongTasks,
        blockingMs: Math.round(this.secBlocking),
        heapMB: readHeapMB(),
        domNodes: document.getElementsByTagName('*').length,
        extra: this.sampleExtra(),
      };
      this.frames = 0;
      this.secLongTasks = 0;
      this.secBlocking = 0;
      const history = this.state.history.length >= HISTORY ? [...this.state.history.slice(1), sample] : [...this.state.history, sample];
      this.state = { ...this.state, history, latest: sample, totals: { ...this.state.totals } };
      for (const l of this.listeners) l();
    }, 1000);
    const releaseInterval = trackResource('interval');
    this.disposers.push(() => {
      clearInterval(interval);
      releaseInterval();
    });
  }

  stop(): void {
    for (const d of this.disposers.splice(0)) d();
  }


  resetTotals(): void {
    this.state = { ...this.state, totals: { longTasks: 0, blockingMs: 0, maxLongTaskMs: 0 } };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.state;
}
