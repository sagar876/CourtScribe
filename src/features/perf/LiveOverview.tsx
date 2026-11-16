import { useEffect, useState } from 'react';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatMs, formatNumber } from '../../lib/format.ts';
import { describeConnection } from '../realtime/connectionStatus.ts';
import { live } from '../realtime/liveSession.ts';
import type { ViewerProbe } from '../transcript/listTypes.ts';
import { useMonitorCommit } from './monitorRenders.ts';
import type { PerfMonitor } from './PerfMonitor.ts';

interface Overview {
  datasetSize: number | null;
  mountedRows: number | null;
  incoming: number;
  processed: number;
  queueDepth: number;
  renderP50: number;
  renderP95: number;
  searchMs: number | null;
  searchEngine: string | null;
  fps: number | null;
  longTasks: number | null;
  maxLongTaskMs: number;
  connection: ReturnType<typeof describeConnection>;
  monitorRenders: number | null;
}

const POLL_MS = 250;

function read(monitor: PerfMonitor, probe: ViewerProbe): Overview {
  const s = live.getSnapshot();
  const perf = monitor.getSnapshot();
  return {
    datasetSize: probe.store?.size ?? null,
    mountedRows: probe.list?.element()?.querySelectorAll('[data-transcript-row]').length ?? null,
    incoming: s.incomingPerSecond,
    processed: s.processedPerSecond,
    queueDepth: s.queueDepth,
    renderP50: s.renderP50,
    renderP95: s.renderP95,
    searchMs: probe.search?.totalMs ?? null,
    searchEngine: probe.search ? (probe.search.engine === 'worker' ? 'Web Worker' : 'main thread') : null,
    fps: perf.latest?.fps ?? null,
    longTasks: perf.supported.longtask ? perf.totals.longTasks : null,
    maxLongTaskMs: perf.totals.maxLongTaskMs,
    connection: describeConnection(s),
    monitorRenders: perf.latest?.extra.monitorRenders ?? null,
  };
}

/**
 * The ten headline metrics in one strip. One polling component at 4 Hz — it
 * reads everything without subscribing, so it is the only thing that re-renders.
 */
export function LiveOverview({ monitor, probe }: { monitor: PerfMonitor; probe: ViewerProbe }) {
  useMonitorCommit();
  const [o, setO] = useState(() => read(monitor, probe));
  useEffect(() => {
    const t = setInterval(() => setO(read(monitor, probe)), POLL_MS);
    return () => clearInterval(t);
  }, [monitor, probe]);

  const latencyHint = Number.isNaN(o.renderP50) ? 'show “Live stream” to measure' : 'socket receive → React commit';
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      <MetricTile label="Dataset size" value={o.datasetSize !== null ? formatNumber(o.datasetSize) : '—'} unit="segments" source="browser" />
      <MetricTile
        label="Mounted rows"
        value={o.mountedRows !== null ? formatNumber(o.mountedRows) : '—'}
        hint={o.datasetSize ? `${((100 * (o.mountedRows ?? 0)) / o.datasetSize).toFixed(o.datasetSize > 10_000 ? 3 : 1)}% of dataset in the DOM` : undefined}
        tone={(o.mountedRows ?? 0) > 2_000 ? 'danger' : 'default'}
        source="browser"
      />
      <MetricTile label="Incoming" value={formatNumber(o.incoming)} unit="events/s" hint="WebSocket frames" source="browser" />
      <MetricTile label="Processed" value={formatNumber(o.processed)} unit="events/s" hint="applied to the store" source="browser" />
      <MetricTile label="Queue depth" value={formatNumber(o.queueDepth)} hint="pending in bounded queue" tone={o.queueDepth > 1_000 ? 'warning' : 'default'} source="browser" />
      <MetricTile label="Connection" value={o.connection.label} hint={o.connection.detail} tone={o.connection.tone === 'danger' ? 'danger' : o.connection.tone === 'warning' ? 'warning' : 'default'} source="browser" />
      <MetricTile label="Event→render p50" value={formatMs(o.renderP50)} unit={Number.isNaN(o.renderP50) ? undefined : 'ms'} hint={latencyHint} source="browser" />
      <MetricTile label="Event→render p95" value={formatMs(o.renderP95)} unit={Number.isNaN(o.renderP95) ? undefined : 'ms'} hint={latencyHint} tone={o.renderP95 > 150 ? 'warning' : 'default'} source="browser" />
      <MetricTile label="Search time" value={o.searchMs !== null ? formatMs(o.searchMs) : '—'} unit={o.searchMs !== null ? 'ms' : undefined} hint={o.searchEngine ? `last query · ${o.searchEngine}` : 'type in the transcript search'} source="browser" />
      <MetricTile label="Frame rate" value={o.fps ?? '—'} unit={o.fps !== null ? 'fps' : undefined} hint="requestAnimationFrame" tone={o.fps !== null && o.fps < 45 ? 'warning' : 'default'} source="browser" />
      <MetricTile
        label="Long tasks"
        value={o.longTasks !== null ? formatNumber(o.longTasks) : 'n/a'}
        hint={o.longTasks !== null ? `max ${formatMs(o.maxLongTaskMs)} ms · PerformanceObserver` : 'Long Tasks API not supported here'}
        tone={o.longTasks ? 'warning' : 'default'}
        source="browser"
      />
      <MetricTile label="Dashboard renders" value={o.monitorRenders ?? '—'} unit={o.monitorRenders !== null ? '/s' : undefined} hint="this monitoring UI's own commits" source="browser" />
    </div>
  );
}
