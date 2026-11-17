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
  longTasks: number | null;
  maxLongTaskMs: number;
  connection: ReturnType<typeof describeConnection>;
}

const POLL_MS = 250;

function read(monitor: PerfMonitor, probe: ViewerProbe): Overview {
  const s = live.getSnapshot();
  const perf = monitor.getSnapshot();
  return {
    datasetSize: probe.store?.size ?? null,
    mountedRows: probe.list?.element()?.querySelectorAll('[data-transcript-row]').length ?? null,
    incoming: s.incomingPerSecond,
    processed: s.processed,
    queueDepth: s.queueDepth,
    renderP50: s.renderP50,
    renderP95: s.renderP95,
    searchMs: probe.search?.totalMs ?? null,
    longTasks: perf.supported.longtask ? perf.totals.longTasks : null,
    maxLongTaskMs: perf.totals.maxLongTaskMs,
    connection: describeConnection(s),
  };
}

/** The key measurements in one strip, polled at 4 Hz by this component only. */
export function LiveOverview({ monitor, probe }: { monitor: PerfMonitor; probe: ViewerProbe }) {
  useMonitorCommit();
  const [o, setO] = useState(() => read(monitor, probe));
  useEffect(() => {
    const t = setInterval(() => setO(read(monitor, probe)), POLL_MS);
    return () => clearInterval(t);
  }, [monitor, probe]);

  const hasLatency = Number.isFinite(o.renderP50);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile
        label="Connection"
        value={o.connection.label}
        hint={o.connection.detail}
        tone={o.connection.tone === 'warning' || o.connection.tone === 'danger' ? 'warning' : 'default'}
        info="Whether this page is connected to the Live Feed server. Throughput and latency figures only move while events are arriving."
      />
      <MetricTile
        label="Events per second"
        value={formatNumber(o.incoming)}
        unit="/s"
        hint="received in the last second"
        info="Live Feed events received per second. Shows the incoming load the page is handling right now."
      />
      <MetricTile
        label="Events processed"
        value={formatNumber(o.processed)}
        hint="applied to the transcript"
        info="Total events checked (duplicates removed, order restored) and applied to the transcript since connecting. Should keep pace with the events received."
      />
      <MetricTile
        label="Queue depth"
        value={formatNumber(o.queueDepth)}
        hint="events waiting"
        tone={o.queueDepth > 1_000 ? 'warning' : 'default'}
        info="Events received but not yet processed. Briefly rising during bursts is normal; a queue that keeps growing means the page cannot keep up."
      />
      <MetricTile
        label="Event → render latency"
        value={hasLatency ? `${formatMs(o.renderP50)} / ${formatMs(o.renderP95)}` : '—'}
        unit={hasLatency ? 'ms' : undefined}
        hint={hasLatency ? 'p50 / p95' : 'shown while “Live stream” is displayed below'}
        tone={o.renderP95 > 150 ? 'warning' : 'default'}
        info="Time from receiving an event to showing it on screen: typical (p50) and slowest 5% (p95). Lower means faster visual feedback; it includes the 50 ms batching window."
      />
      <MetricTile
        label="Rendered rows"
        value={o.mountedRows !== null ? formatNumber(o.mountedRows) : '—'}
        hint={o.datasetSize !== null ? `of ${formatNumber(o.datasetSize)} transcript lines` : undefined}
        info="Transcript rows actually present on the page. With virtualisation this stays small however long the transcript is — that is what keeps 100,000 lines fast."
      />
      <MetricTile
        label="Long tasks"
        value={o.longTasks !== null ? formatNumber(o.longTasks) : 'n/a'}
        hint={o.longTasks !== null ? (o.longTasks ? `longest ${formatMs(o.maxLongTaskMs)} ms` : 'since this page opened') : 'not supported by this browser'}
        tone={o.longTasks ? 'warning' : 'default'}
        info="Moments when the page was busy for more than 50 ms in one go — long enough for clicks or scrolling to feel delayed. Fewer is better."
      />
      <MetricTile
        label="Search time"
        value={o.searchMs !== null ? formatMs(o.searchMs) : '—'}
        unit={o.searchMs !== null ? 'ms' : undefined}
        hint={o.searchMs !== null ? 'last search' : 'search the transcript below'}
        info="How long the last transcript search took, from typing to results. It runs in a background thread, so the page stays responsive even on 100,000 lines."
      />
    </div>
  );
}
