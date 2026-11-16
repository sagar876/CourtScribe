import { trackResource } from '../../../lib/resources.ts';

export interface RunMeasurements {
  fpsAvg: number;
  fpsMin: number;
  longTasks: number | null;
  blockingMs: number | null;
  peakRows: number;
  peakDomNodes: number;
}

/**
 * Measures one benchmark run: FPS from requestAnimationFrame (per-second
 * buckets), long tasks from PerformanceObserver (when supported), and the
 * peak mounted rows / DOM nodes inside the variant's container.
 */
export function startRunMeter(container: HTMLElement): { stop: () => RunMeasurements } {
  const fps: number[] = [];
  let frames = 0;
  let bucketStart = performance.now();
  let raf = 0;
  const frame = () => {
    frames++;
    const now = performance.now();
    if (now - bucketStart >= 1000) {
      fps.push((frames * 1000) / (now - bucketStart));
      frames = 0;
      bucketStart = now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const releaseRaf = trackResource('raf-loop');

  const supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask');
  let longTasks = 0;
  let blockingMs = 0;
  let observer: PerformanceObserver | null = null;
  let releaseObserver: (() => void) | null = null;
  if (supported) {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++;
        blockingMs += Math.max(0, e.duration - 50);
      }
    });
    observer.observe({ type: 'longtask' });
    releaseObserver = trackResource('observer');
  }

  const all = container.getElementsByTagName('*'); // live collection, no re-query
  let peakRows = 0;
  let peakDomNodes = 0;
  const sample = () => {
    peakDomNodes = Math.max(peakDomNodes, all.length);
    peakRows = Math.max(peakRows, container.querySelectorAll('[data-transcript-row]').length);
  };
  sample();
  const interval = setInterval(sample, 250);
  const releaseInterval = trackResource('interval');

  return {
    stop() {
      sample();
      cancelAnimationFrame(raf);
      clearInterval(interval);
      observer?.disconnect();
      releaseRaf();
      releaseInterval();
      releaseObserver?.();
      return {
        fpsAvg: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : NaN,
        fpsMin: fps.length ? Math.min(...fps) : NaN,
        longTasks: supported ? longTasks : null,
        blockingMs: supported ? blockingMs : null,
        peakRows,
        peakDomNodes,
      };
    },
  };
}
