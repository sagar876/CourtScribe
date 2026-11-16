import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PerfMonitor } from './PerfMonitor.ts';

/** Starts a PerfMonitor for the lifetime of the calling component. */
export function usePerfMonitor(sampleExtra: () => Record<string, number | null>) {
  const extraRef = useRef(sampleExtra);
  extraRef.current = sampleExtra;
  const [monitor] = useState(() => new PerfMonitor(() => extraRef.current()));
  useEffect(() => {
    monitor.start();
    return () => monitor.stop();
  }, [monitor]);
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  return { state, resetTotals: () => monitor.resetTotals() };
}
