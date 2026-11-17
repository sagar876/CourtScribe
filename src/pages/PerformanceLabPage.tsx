import { useState } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { Card } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { AbBench } from '../features/perf/ab/AbBench.tsx';
import { LiveOverview } from '../features/perf/LiveOverview.tsx';
import { PerfCharts } from '../features/perf/PerfCharts.tsx';
import { TransferOverview } from '../features/perf/TransferOverview.tsx';
import { usePerfMonitor } from '../features/perf/usePerfMonitor.ts';
import { live, liveTranscript } from '../features/realtime/liveSession.ts';
import { StreamControls } from '../features/realtime/StreamControls.tsx';
import { createViewerProbe } from '../features/transcript/listTypes.ts';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { TranscriptViewer, type RenderMode } from '../features/transcript/TranscriptViewer.tsx';
import type { SearchEngine } from '../features/transcript/useTranscriptSearch.ts';

type Source = 1_000 | 10_000 | 50_000 | 100_000 | 'live';
const NAIVE_LIMIT = 10_000;
const SOURCES: { value: Source; label: string }[] = [
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 50_000, label: '50K' },
  { value: 100_000, label: '100K' },
  { value: 'live', label: 'Live stream' },
];

/**
 * Engineering diagnostics. The page itself subscribes to nothing that ticks: each live panel owns
 * its own subscription or poll, so a measurement re-renders only that panel.
 */
export function PerformanceLabPage() {
  const [datasetStore] = useState(() => {
    const s = new TranscriptStore();
    s.load(generateTranscript(10_000));
    return s;
  });
  const [source, setSource] = useState<Source>(10_000);
  const [renderMode, setRenderMode] = useState<RenderMode>('virtual');
  const [engine, setEngine] = useState<SearchEngine>('worker');
  const [probe] = useState(createViewerProbe);

  const monitor = usePerfMonitor(() => {
    const s = live.getSnapshot();
    return {
      rx: s.incomingPerSecond,
      processed: s.processedPerSecond,
      p50: Number.isFinite(s.renderP50) ? s.renderP50 : null,
      p95: Number.isFinite(s.renderP95) ? s.renderP95 : null,
    };
  });

  const selectSource = (next: Source) => {
    if (next !== 'live') datasetStore.load(generateTranscript(next));
    if (next === 'live' || next > NAIVE_LIMIT) setRenderMode('virtual');
    setSource(next);
  };

  const store = source === 'live' ? liveTranscript : datasetStore;
  const naiveDisabled = source === 'live' || source > NAIVE_LIMIT;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Engineering diagnostics"
        title="Performance Lab"
        description="How CourtScribe behaves under load: live measurements taken in this browser, plus controls to stress the Live Feed and large transcripts."
      />

      <Card
        title="Live metrics"
        description="Measured in this browser, updated four times a second."
        info="Hover the ⓘ beside each metric for what it measures and how to read it. Values move while the Live Feed or the stress controls are sending events."
      >
        <LiveOverview monitor={monitor} probe={probe} />
      </Card>

      <Card
        title="Uploads, downloads and storage"
        description="Real transfers from the Documents page, and this browser’s storage."
        info="These values come from actual uploads and downloads you make on the Documents page (they keep running if you switch pages) and the browser’s own storage estimate. Nothing here is simulated."
      >
        <TransferOverview />
      </Card>

      <Card
        title="Stress controls"
        info="Drive the Live Feed server with synthetic courtroom dialogue: choose an event rate, send bursts, inject duplicates or out-of-order events, and simulate dropped connections. Requires the Live Feed server (not available in local mode)."
      >
        <StreamControls />
      </Card>

      <Card title="Over time" info="The last 60 seconds, one point per second. Received and processed should track each other; latency should stay flat as load rises.">
        <PerfCharts monitor={monitor} />
      </Card>

      <Card
        title="Large transcript"
        info={
          <>
            Load up to 100,000 sample lines (or the live stream) and compare rendering strategies. <b>Virtualised</b> draws only the rows on screen; <b>Naive</b> draws every row (limited to
            10,000 to keep the tab usable). Search can run in a background thread or on the main thread. Watch <b>Rendered rows</b>, <b>Search time</b> and <b>Long tasks</b> above.
          </>
        }
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
              {
                value: 'naive',
                label: 'Naive (all rows)',
                disabled: naiveDisabled,
                title: naiveDisabled ? `Naive rendering is limited to ${NAIVE_LIMIT.toLocaleString()} sample lines to keep the tab usable` : undefined,
              },
            ]}
          />
          <SegmentedControl<SearchEngine>
            label="Search"
            value={engine}
            onChange={setEngine}
            size="md"
            options={[
              { value: 'worker', label: 'Background thread' },
              { value: 'main-thread', label: 'Main thread' },
            ]}
          />
        </div>
        <TranscriptViewer key={`${source}-${renderMode}`} store={store} live={source === 'live'} renderMode={renderMode} searchEngine={engine} probe={probe} showDiagnostics listClassName="h-[520px]" />
      </Card>

      <Card
        title="A/B comparison"
        info="Runs the same event stream twice: A is a naive implementation (every row drawn, the page updated for every single event); B is CourtScribe’s approach (virtualised rows, events applied in small batches). Each run uses its own connection; the main Live Feed pauses meanwhile. Requires the Live Feed server."
      >
        <AbBench />
      </Card>
    </div>
  );
}
