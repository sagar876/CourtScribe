import { useRef, useState } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { Card } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { SourceBadge } from '../components/ui/SourceBadge.tsx';
import { AbBench } from '../features/perf/ab/AbBench.tsx';
import { LiveOverview } from '../features/perf/LiveOverview.tsx';
import { readMonitorCommits } from '../features/perf/monitorRenders.ts';
import { PerfCharts } from '../features/perf/PerfCharts.tsx';
import { RuntimePanel } from '../features/perf/RuntimePanel.tsx';
import { RecordingDiagnostics } from '../features/recording/RecordingDiagnostics.tsx';
import { usePerfMonitor } from '../features/perf/usePerfMonitor.ts';
import { live, liveTranscript } from '../features/realtime/liveSession.ts';
import { StreamControls } from '../features/realtime/StreamControls.tsx';
import { StreamMetrics } from '../features/realtime/StreamMetrics.tsx';
import { createViewerProbe } from '../features/transcript/listTypes.ts';
import { createViewerStats } from '../features/transcript/renderStats.ts';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { TranscriptViewer, type RenderMode } from '../features/transcript/TranscriptViewer.tsx';
import type { SearchEngine } from '../features/transcript/useTranscriptSearch.ts';
import { formatMs, formatNumber } from '../lib/format.ts';

type Source = 1_000 | 10_000 | 50_000 | 100_000 | 'live';
const NAIVE_LIMIT = 10_000;
const SOURCES: { value: Source; label: string }[] = [
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 50_000, label: '50K' },
  { value: 100_000, label: '100K' },
  { value: 'live', label: 'Live stream' },
];

function loadDataset(store: TranscriptStore, size: number): number {
  const t0 = performance.now();
  store.load(generateTranscript(size));
  return performance.now() - t0;
}

/** Counts that are sampled as per-second deltas. */
function useDelta() {
  const prev = useRef(new Map<string, number>());
  return (key: string, value: number) => {
    const last = prev.current.get(key) ?? value;
    prev.current.set(key, value);
    return Math.max(0, value - last);
  };
}

/**
 * The page itself subscribes to nothing that ticks: every live panel owns its
 * own subscription or poll, so a sample re-renders only that panel.
 */
export function PerformanceLabPage() {
  const [datasetStore] = useState(() => new TranscriptStore());
  const [source, setSource] = useState<Source>(10_000);
  const [genMs, setGenMs] = useState<number | null>(() => loadDataset(datasetStore, 10_000));
  const [renderMode, setRenderMode] = useState<RenderMode>('virtual');
  const [engine, setEngine] = useState<SearchEngine>('worker');
  const [viewerStats] = useState(createViewerStats);
  const [probe] = useState(createViewerProbe);
  const delta = useDelta();

  const monitor = usePerfMonitor(() => {
    const s = live.getSnapshot();
    return {
      rx: s.incomingPerSecond,
      processed: s.processedPerSecond,
      serverRate: s.server?.sendRateLastSecond ?? null,
      p50: Number.isFinite(s.renderP50) ? s.renderP50 : null,
      p95: Number.isFinite(s.renderP95) ? s.renderP95 : null,
      queue: s.queueDepth,
      listCommits: delta('list', viewerStats.listCommits),
      monitorRenders: delta('monitor', readMonitorCommits()),
    };
  });

  const selectSource = (next: Source) => {
    if (next !== 'live') setGenMs(loadDataset(datasetStore, next));
    if (next === 'live' || next > NAIVE_LIMIT) setRenderMode('virtual');
    setSource(next);
  };

  const store = source === 'live' ? liveTranscript : datasetStore;
  const naiveDisabled = source === 'live' || source > NAIVE_LIMIT;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Frontend engineering"
        title="Performance Lab"
        description="Live measurements of rendering, real-time throughput and resilience. Every number is labelled with where it comes from; nothing is hard-coded."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source="browser" />
            <SourceBadge source="server" />
            <SourceBadge source="simulated" />
          </div>
        }
      />

      <Card title="Live metrics" description="Polled at 4 Hz by a single component. Dataset, mounted rows and search refer to the transcript viewer below.">
        <LiveOverview monitor={monitor} probe={probe} />
      </Card>

      <Card title="Stress controls" description="Real WebSocket traffic from the local ws server. Choose “Live stream” in the transcript viewer to render it.">
        <StreamControls />
      </Card>

      <Card title="Over time" description="Last 60 seconds, one sample per second.">
        <PerfCharts monitor={monitor} />
      </Card>

      <Card title="Transcript rendering" description="Change the dataset size, rendering strategy and search engine." bodyClassName="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-end gap-5">
          <SegmentedControl<Source> label="Dataset" value={source} options={SOURCES} onChange={selectSource} size="md" />
          <SegmentedControl<RenderMode>
            label="Rendering"
            value={renderMode}
            onChange={setRenderMode}
            size="md"
            options={[
              { value: 'virtual', label: 'Virtualised' },
              {
                value: 'naive',
                label: 'Naive (all rows)',
                disabled: naiveDisabled,
                title: naiveDisabled ? `Naive rendering is capped at ${NAIVE_LIMIT.toLocaleString()} static segments to keep the tab usable` : undefined,
              },
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
          probe={probe}
          showBenchmark
          benchmarkExtra={
            source === 'live' ? (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                Segments arrive over the WebSocket <SourceBadge source="simulated" compact /> content is synthetic
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

      <Card title="A/B comparison" description="A: naive — every row mounted, setState on every incoming event. B: optimised — virtualised rows, batched store updates.">
        <AbBench />
      </Card>

      <Card title="Stream details" description="Integrity, resilience and server-side counters for the main live feed.">
        <StreamMetrics />
      </Card>

      <Card title="Audio recording diagnostics" description="Microphone capture in this browser. Separate from the WebSocket transcript metrics above — audio is never sent to the stream server.">
        <RecordingDiagnostics />
      </Card>

      <Card title="Runtime & resources">
        <RuntimePanel monitor={monitor} />
      </Card>
    </div>
  );
}
