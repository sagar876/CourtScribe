import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PerfMonitor, type PerfState } from './PerfMonitor.ts';

/**
 * Owns a PerfMonitor for the lifetime of the caller WITHOUT subscribing to it,
 * so the page that hosts it does not re-render on every sample.
 */
export function usePerfMonitor(sampleExtra: () => Record<string, number | null>): PerfMonitor {
  const extraRef = useRef(sampleExtra);
  useLayoutEffect(() => {
    extraRef.current = sampleExtra;
  });
  const [monitor] = useState(() => new PerfMonitor());
  useEffect(() => {
    monitor.setSampler(() => extraRef.current());
    monitor.start();
    return () => monitor.stop();
  }, [monitor]);
  return monitor;
}

/** Leaf components subscribe here (1 Hz). */
export function usePerfState(monitor: PerfMonitor): PerfState {
  return useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
}
