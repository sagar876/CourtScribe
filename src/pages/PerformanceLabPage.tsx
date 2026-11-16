import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { MetricTile } from '../components/ui/MetricTile.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { SourceBadge } from '../components/ui/SourceBadge.tsx';
import { ChartErrorBoundary, LineChart, type ChartPoint } from '../features/perf/LineChart.tsx';
import { usePerfMonitor } from '../features/perf/usePerfMonitor.ts';
import type { PerfSample } from '../features/perf/PerfMonitor.ts';
import { live, liveTranscript } from '../features/realtime/liveSession.ts';
import { StreamControls } from '../features/realtime/StreamControls.tsx';
import { StreamMetrics } from '../features/realtime/StreamMetrics.tsx';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { TranscriptViewer, type RenderMode } from '../features/transcript/TranscriptViewer.tsx';
import { createViewerStats } from '../features/transcript/renderStats.ts';
import type { SearchEngine } from '../features/transcript/useTranscriptSearch.ts';
import { formatMs, formatNumber } from '../lib/format.ts';
import { resourceRegistry } from '../lib/resources.ts';

type Source = 1_000 | 10_000 | 50_000 | 100_000 | 'live';
const NAIVE_LIMIT = 10_000;
const SOURCES: { value: Source; label: string }[] = [
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 50_000, label: '50K' },
  { value: 100_000, label: '100K' },
  { value: 'live', label: 'Live stream' },
];

const C = { navy: '#1a2d4f', blue: '#3b6fb8', amber: '#d97706', green: '#059669', slate: '#94a3b8', red: '#dc2626' };

function loadDataset(store: TranscriptStore, size: number): number {
  const t0 = performance.now();
  store.load(generateTranscript(size));
  return performance.now() - t0;
}

function series(history: readonly PerfSample[], pick: Record<string, (s: PerfSample) => number | null | undefined>): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const s of history) for (const [name, fn] of Object.entries(pick)) {
    const v = fn(s);
    if (v != null && Number.isFinite(v)) out.push({ t: s.t, value: v, series: name });
  }
  return out;
}

export function PerformanceLabPage() {
  const [datasetStore] = useState(() => new TranscriptStore());
  const [source, setSource] = useState<Source>(10_000);
  const [genMs, setGenMs] = useState<number | null>(() => loadDataset(datasetStore, 10_000));
  const [renderMode, setRenderMode] = useState<RenderMode>('virtual');
  const [engine, setEngine] = useState<SearchEngine>('worker');
  const [viewerStats] = useState(createViewerStats);
  const resources = useSyncExternalStore(resourceRegistry.subscribe, resourceRegistry.getSnapshot);

  const prevCommits = useRef(0);
  const { state: perf, resetTotals } = usePerfMonitor(() => {
    const s = live.getSnapshot();
    const commits = viewerStats.listCommits;
    const delta = Math.max(0, commits - prevCommits.current);
    prevCommits.current = commits;
    return {
      rx: s.incomingPerSecond,
      processed: s.processedPerSecond,
      serverRate: s.server?.sendRateLastSecond ?? null,
      p50: Number.isFinite(s.renderP50) ? s.renderP50 : null,
      p95: Number.isFinite(s.renderP95) ? s.renderP95 : null,
      queue: s.queueDepth,
      listCommits: delta,
    };
  });

  const selectSource = (next: Source) => {
    if (next !== 'live') setGenMs(loadDataset(datasetStore, next));
    if (next === 'live' || next > NAIVE_LIMIT) setRenderMode('virtual');
    setSource(next);
  };

  const store = source === 'live' ? liveTranscript : datasetStore;
  const naiveDisabled = source === 'live' || source > NAIVE_LIMIT;

  const charts = useMemo(() => {
    const h = perf.history;
    return {
      fps: series(h, { FPS: (s) => s.fps, 'Blocking ms/s': (s) => s.blockingMs }),
      throughput: series(h, {
        'Server sent/s': (s) => s.extra.serverRate,
        'Incoming/s': (s) => s.extra.rx,
        'Processed/s': (s) => s.extra.processed,
      }),
      latency: series(h, { 'Event→render p50 ms': (s) => s.extra.p50, 'Event→render p95 ms': (s) => s.extra.p95 }),
      load: series(h, { 'Queue depth': (s) => s.extra.queue, 'List renders/s': (s) => s.extra.listCommits }),
    };
  }, [perf.history]);

  const latest = perf.latest;
  const totalResources = Object.values(resources).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Frontend engineering"
        title="Performance Lab"
        description="Rendering, real-time throughput and resilience under load. Every number is labelled with where it comes from."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source="browser" />
            <SourceBadge source="server" />
            <SourceBadge source="simulated" />
          </div>
        }
      />

      <Card
        title="Runtime vitals"
        description="Sampled once per second from this tab."
        actions={
          <Button size="sm" variant="ghost" onClick={resetTotals}>
            Reset long-task totals
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="Frame rate" value={latest ? latest.fps : '—'} unit="fps" tone={latest && latest.fps < 45 ? 'warning' : 'default'} hint="requestAnimationFrame" source="browser" />
          <MetricTile
            label="Long tasks"
            value={perf.supported.longtask ? formatNumber(perf.totals.longTasks) : 'n/a'}
            hint={perf.supported.longtask ? `max ${formatMs(perf.totals.maxLongTaskMs)} ms` : 'Long Tasks API unsupported'}
            tone={perf.totals.longTasks ? 'warning' : 'default'}
            source="browser"
          />
          <MetricTile label="Total blocking" value={perf.supported.longtask ? formatNumber(perf.totals.blockingMs) : 'n/a'} unit="ms" hint="Σ (long task − 50 ms)" source="browser" />
          <MetricTile
            label="JS heap"
            value={latest?.heapMB != null ? formatNumber(latest.heapMB, 1) : 'n/a'}
            unit={latest?.heapMB != null ? 'MB' : undefined}
            hint={perf.supported.memory ? 'performance.memory (Chromium)' : 'Not exposed by this browser'}
            source="browser"
          />
          <MetricTile label="DOM nodes" value={latest ? formatNumber(latest.domNodes) : '—'} hint="whole document" source="browser" />
          <MetricTile label="Live resources" value={formatNumber(totalResources)} hint="sockets, workers, loops, charts" source="browser" />
        </div>
      </Card>

      <Card
        title="Transcript rendering"
        description="Virtualised list vs. a naive full-DOM render, with Web Worker vs. main-thread search."
        bodyClassName="flex flex-col gap-4 p-5"
      >
        <div className="flex flex-wrap items-end gap-5">
          <SegmentedControl<Source> label="Dataset" value={source} options={SOURCES} onChange={selectSource} size="md" />
          <SegmentedControl<RenderMode>
            label="Rendering"
            value={renderMode}
            onChange={setRenderMode}
            size="md"
            options={[
              { value: 'virtual', label: 'Virtualised' },
              { value: 'naive', label: 'Naive (all rows)', disabled: naiveDisabled, title: naiveDisabled ? `Naive rendering is capped at ${NAIVE_LIMIT.toLocaleString()} static segments to keep the tab usable` : undefined },
            ]}
          />
          <SegmentedControl<SearchEngine>
            label="Search"
            value={engine}
            onChange={setEngine}
            size="md"
            options={[
              { value: 'worker', label: 'Web Worker' },
              { value: 'main-thread', label: 'Main thread (naive)' },
            ]}
          />
        </div>
        <TranscriptViewer
          key={`${source}-${renderMode}`}
          store={store}
          live={source === 'live'}
          renderMode={renderMode}
          searchEngine={engine}
          stats={viewerStats}
          showBenchmark
          benchmarkExtra={
            source === 'live' ? (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                Segments arrive from the stream below <SourceBadge source="simulated" compact /> <span>content is synthetic</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                Generated {formatNumber(datasetStore.size)} synthetic segments in {formatMs(genMs)} ms on the main thread <SourceBadge source="simulated" compact />
              </span>
            )
          }
          listClassName="h-[520px]"
        />
      </Card>

      <Card title="Real-time stream" description="Real WebSocket traffic from the local ws server (port 8787). Switch the dataset above to “Live stream” to watch the transcript fill.">
        <div className="flex flex-col gap-5">
          <StreamControls />
          <StreamMetrics />
        </div>
      </Card>

      <Card title="Over time" description="Last 60 seconds, one sample per second.">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <ChartBlock title="Frame rate & main-thread blocking" source="browser">
            <LineChart data={charts.fps} colors={[C.navy, C.red]} ariaLabel="Frames per second and blocking time" />
          </ChartBlock>
          <ChartBlock title="Throughput" source="mixed">
            <LineChart data={charts.throughput} colors={[C.slate, C.blue, C.green]} ariaLabel="Server send rate, received and processed events per second" />
          </ChartBlock>
          <ChartBlock title="Event → render latency" source="browser">
            <LineChart data={charts.latency} colors={[C.blue, C.amber]} unit="" ariaLabel="Latency p50 and p95" />
          </ChartBlock>
          <ChartBlock title="Queue depth & list renders" source="browser">
            <LineChart data={charts.load} colors={[C.red, C.navy]} ariaLabel="Queue depth and list renders per second" />
          </ChartBlock>
        </div>
      </Card>

      <Card title="Resource cleanup" description="Every long-lived resource registers on creation and releases on cleanup. Navigate to Workspace and back — page-scoped resources return to their baseline.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(['websocket', 'worker', 'observer', 'raf-loop', 'interval', 'chart'] as const).map((k) => (
            <MetricTile key={k} label={k} value={formatNumber(resources[k] ?? 0)} hint="active now" source="browser" />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ChartBlock({ title, source, children }: { title: string; source: 'browser' | 'mixed'; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
        {source === 'mixed' ? (
          <span className="flex gap-1">
            <SourceBadge source="server" compact />
            <SourceBadge source="browser" compact />
          </span>
        ) : (
          <SourceBadge source="browser" compact />
        )}
      </div>
      <ChartErrorBoundary>{children}</ChartErrorBoundary>
    </div>
  );
}
