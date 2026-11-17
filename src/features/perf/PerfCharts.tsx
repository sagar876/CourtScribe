import { useMemo } from 'react';
import { ChartErrorBoundary, LineChart, type ChartPoint } from './LineChart.tsx';
import { useMonitorCommit } from './monitorRenders.ts';
import type { PerfMonitor, PerfSample } from './PerfMonitor.ts';
import { usePerfState } from './usePerfMonitor.ts';

const C = { blue: '#3b6fb8', amber: '#d97706', green: '#059669' };

function series(history: readonly PerfSample[], pick: Record<string, (s: PerfSample) => number | null | undefined>): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const s of history)
    for (const [name, fn] of Object.entries(pick)) {
      const v = fn(s);
      if (v != null && Number.isFinite(v)) out.push({ t: s.t, value: v, series: name });
    }
  return out;
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h3 className="mb-1 text-xs font-semibold text-slate-700">{title}</h3>
      <ChartErrorBoundary>{children}</ChartErrorBoundary>
    </div>
  );
}

/** Subscribes to the 1 Hz monitor itself; charts update via changeData, never re-created. */
export function PerfCharts({ monitor }: { monitor: PerfMonitor }) {
  useMonitorCommit();
  const { history } = usePerfState(monitor);
  const data = useMemo(
    () => ({
      throughput: series(history, {
        'Received/s': (s) => s.extra.rx,
        'Processed/s': (s) => s.extra.processed,
      }),
      latency: series(history, { 'p50 ms': (s) => s.extra.p50, 'p95 ms': (s) => s.extra.p95 }),
    }),
    [history],
  );
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <ChartBlock title="Events per second">
        <LineChart data={data.throughput} colors={[C.blue, C.green]} ariaLabel="Events received and processed per second over the last minute" />
      </ChartBlock>
      <ChartBlock title="Event → render latency">
        <LineChart data={data.latency} colors={[C.blue, C.amber]} ariaLabel="Event to render latency p50 and p95 over the last minute" />
      </ChartBlock>
    </div>
  );
}
