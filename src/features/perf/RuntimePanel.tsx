import { useSyncExternalStore } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatMs, formatNumber } from '../../lib/format.ts';
import { resourceRegistry } from '../../lib/resources.ts';
import { useMonitorCommit } from './monitorRenders.ts';
import type { PerfMonitor } from './PerfMonitor.ts';
import { usePerfState } from './usePerfMonitor.ts';

const KINDS = ['websocket', 'worker', 'observer', 'raf-loop', 'interval', 'chart', 'audio', 'waveform', 'object-url', 'media-stream', 'audio-context'] as const;

export function RuntimePanel({ monitor }: { monitor: PerfMonitor }) {
  useMonitorCommit();
  const perf = usePerfState(monitor);
  const resources = useSyncExternalStore(resourceRegistry.subscribe, resourceRegistry.getSnapshot);
  const latest = perf.latest;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Total blocking" value={perf.supported.longtask ? formatNumber(perf.totals.blockingMs) : 'n/a'} unit="ms" hint={`Σ(long task − 50 ms) · max ${formatMs(perf.totals.maxLongTaskMs)} ms`} source="browser" />
        <MetricTile
          label="JS heap"
          value={latest?.heapMB != null ? formatNumber(latest.heapMB, 1) : 'n/a'}
          unit={latest?.heapMB != null ? 'MB' : undefined}
          hint={perf.supported.memory ? 'performance.memory (Chromium only)' : 'not exposed by this browser'}
          source="browser"
        />
        <MetricTile label="DOM nodes" value={latest ? formatNumber(latest.domNodes) : '—'} hint="whole document" source="browser" />
        <div className="flex items-center">
          <Button size="sm" variant="ghost" onClick={() => monitor.resetTotals()}>
            Reset long-task totals
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-slate-500">Active resources — each registers on creation and releases on cleanup. Audio and waveform belong to the Workspace player and read 0 here; microphone streams and audio contexts exist only while recording; object URLs include kept recordings.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-11">
          {KINDS.map((k) => (
            <MetricTile key={k} label={k} value={formatNumber(resources[k] ?? 0)} source="browser" />
          ))}
        </div>
      </div>
    </div>
  );
}
