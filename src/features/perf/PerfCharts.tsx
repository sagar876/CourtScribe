import { useMemo } from 'react';
import { SourceBadge } from '../../components/ui/SourceBadge.tsx';
import { ChartErrorBoundary, LineChart, type ChartPoint } from './LineChart.tsx';
import { useMonitorCommit } from './monitorRenders.ts';
import type { PerfMonitor, PerfSample } from './PerfMonitor.ts';
import { usePerfState } from './usePerfMonitor.ts';

const C = { navy: '#1a2d4f', blue: '#3b6fb8', amber: '#d97706', green: '#059669', slate: '#94a3b8', red: '#dc2626' };

function series(history: readonly PerfSample[], pick: Record<string, (s: PerfSample) => number | null | undefined>): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const s of history)
    for (const [name, fn] of Object.entries(pick)) {
      const v = fn(s);
      if (v != null && Number.isFinite(v)) out.push({ t: s.t, value: v, series: name });
    }
  return out;
}

function ChartBlock({ title, mixed = false, children }: { title: string; mixed?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
        <span className="flex gap-1">
          {mixed && <SourceBadge source="server" compact />}
          <SourceBadge source="browser" compact />
        </span>
      </div>
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
        'Server sent/s': (s) => s.extra.serverRate,
        'Incoming/s': (s) => s.extra.rx,
        'Processed/s': (s) => s.extra.processed,
      }),
      latency: series(history, { 'Event→render p50 ms': (s) => s.extra.p50, 'Event→render p95 ms': (s) => s.extra.p95 }),
      fps: series(history, { FPS: (s) => s.fps, 'Blocking ms/s': (s) => s.blockingMs }),
      load: series(history, { 'Queue depth': (s) => s.extra.queue, 'List renders/s': (s) => s.extra.listCommits }),
    }),
    [history],
  );
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <ChartBlock title="Event throughput" mixed>
        <LineChart data={data.throughput} colors={[C.slate, C.blue, C.green]} ariaLabel="Server send rate, incoming and processed events per second" />
      </ChartBlock>
      <ChartBlock title="Event → render latency">
        <LineChart data={data.latency} colors={[C.blue, C.amber]} ariaLabel="Event to render latency p50 and p95" />
      </ChartBlock>
      <ChartBlock title="Frame rate & main-thread blocking">
        <LineChart data={data.fps} colors={[C.navy, C.red]} ariaLabel="Frames per second and blocking time" />
      </ChartBlock>
      <ChartBlock title="Queue depth & list renders">
        <LineChart data={data.load} colors={[C.red, C.navy]} ariaLabel="Queue depth and list renders per second" />
      </ChartBlock>
    </div>
  );
}
