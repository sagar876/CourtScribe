import { useEffect, useRef, useState } from 'react';
import { STREAM_RATES, type StreamRate, type TranscriptEvent } from '../../../../shared/protocol.ts';
import type { TranscriptSegment } from '../../../../shared/transcript.ts';
import { generateTranscript } from '../../../../shared/transcriptGenerator.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { SegmentedControl } from '../../../components/ui/SegmentedControl.tsx';
import { SourceBadge } from '../../../components/ui/SourceBadge.tsx';
import { cn } from '../../../lib/cn.ts';
import { formatMs, formatNumber } from '../../../lib/format.ts';
import { SampleWindow } from '../../../lib/stats.ts';
import { ConnectionManager } from '../../realtime/ConnectionManager.ts';
import { EventPipeline } from '../../realtime/EventPipeline.ts';
import { live, STREAM_URL, toSegment } from '../../realtime/liveSession.ts';
import { RenderLatencyTracker } from '../../realtime/RenderLatencyTracker.ts';
import { createViewerStats, type ViewerStats } from '../../transcript/renderStats.ts';
import { TranscriptStore } from '../../transcript/TranscriptStore.ts';
import { VirtualTranscriptList } from '../../transcript/VirtualTranscriptList.tsx';
import { useMonitorCommit } from '../monitorRenders.ts';
import { naiveSearch, workerSearch, type BenchSearch } from './benchSearch.ts';
import { NaiveLiveList, type NaiveSink } from './NaiveLiveList.tsx';
import { startRunMeter, type RunMeasurements } from './runMeter.ts';

type Variant = 'A' | 'B';
type SeedSize = 1_000 | 5_000 | 10_000;
type Seconds = 5 | 10 | 20;

interface AbConfig {
  seed: SeedSize;
  rate: StreamRate;
  seconds: Seconds;
}

interface AbResult extends RunMeasurements {
  config: AbConfig;
  received: number;
  rendered: number;
  /** A: setState calls (one per event). B: store notifications (one per batch). */
  stateUpdates: number;
  listCommits: number;
  rowCommits: number;
  latP50: number;
  latP95: number;
  search: BenchSearch;
}

type Running = { variant: Variant; seed: TranscriptSegment[]; stats: ViewerStats; latency: SampleWindow; store: TranscriptStore | null; phase: string };

const SEARCH_QUERY = 'exhibit';
const EMPTY = new Int32Array(0);
const noop = () => {};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

const nextFrames = (n: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(n);
});

async function waitFor(check: () => boolean, timeoutMs: number, signal: AbortSignal, message: string): Promise<void> {
  const until = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() > until) throw new Error(message);
    await sleep(50, signal);
  }
}

/** Seed rows get their own id space so live events never overwrite them. */
const makeSeed = (n: number) => generateTranscript(n).map((s) => ({ ...s, id: `seed-${s.id}` }));

/**
 * A/B harness. Each variant gets its own WebSocket connection, the same seed
 * transcript, event rate and duration; variants run one after another so they
 * never share the main thread. The app's main live feed is paused meanwhile.
 */
export function AbBench() {
  useMonitorCommit();
  const [config, setConfig] = useState<AbConfig>({ seed: 5_000, rate: 100, seconds: 10 });
  const [running, setRunning] = useState<Running | null>(null);
  const [results, setResults] = useState<Partial<Record<Variant, AbResult>>>({});
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const naiveSink = useRef<NaiveSink | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function runVariant(variant: Variant, signal: AbortSignal): Promise<AbResult> {
    const cfg = config;
    const seed = makeSeed(cfg.seed);
    const stats = createViewerStats();
    const latency = new SampleWindow(50_000);
    let received = 0;

    let store: TranscriptStore | null = null;
    let pipeline: EventPipeline | null = null;
    let tracker: RenderLatencyTracker | null = null;
    if (variant === 'B') {
      const s = new TranscriptStore(seed);
      const t = new RenderLatencyTracker(s);
      store = s;
      tracker = t;
      pipeline = new EventPipeline((batch) => {
        s.upsert(batch.map((q) => toSegment(q.event, 'live-')));
        t.expect(batch.map((q) => q.receivedAt));
      });
    }

    setRunning({ variant, seed, stats, latency, store, phase: 'mounting seed' });
    await nextFrames(3);
    if (!containerRef.current) throw new Error('Benchmark container missing');
    const meter = startRunMeter(containerRef.current);

    const onEvent = (event: TranscriptEvent, receivedAt: number) => {
      received++;
      if (pipeline) pipeline.ingest(event, receivedAt);
      else naiveSink.current?.push(toSegment(event, 'live-'), receivedAt);
    };
    if (!STREAM_URL) throw new Error('The Live Feed server is not configured for this deployment (VITE_STREAM_URL).');
    const conn = new ConnectionManager(STREAM_URL, {
      onEvent,
      onHello: (h) => (pipeline ? pipeline.startSession(h.startSeq, false, 0) : h.startSeq - 1),
    });
    if (pipeline) pipeline.onProgress((seq) => conn.setProcessedSeq(seq));

    let m: RunMeasurements | null = null;
    let streaming = false;
    try {
      conn.connect();
      await waitFor(() => conn.s.state === 'connected', 5_000, signal, `Stream server unreachable at ${STREAM_URL}`);
      conn.configureServer({ rate: cfg.rate, running: true });
      streaming = true;
      setRunning((r) => r && { ...r, phase: `streaming ${cfg.rate} events/s` });
      await sleep(cfg.seconds * 1_000, signal);
      conn.configureServer({ running: false });
      streaming = false;
      setRunning((r) => r && { ...r, phase: 'draining' });
      await sleep(500, signal);
      pipeline?.flushAll();
      await nextFrames(2);
      m = meter.stop();
    } finally {
      // Also runs when aborted (navigation mid-run): never leave the simulator running or loops alive.
      if (streaming) conn.configureServer({ running: false });
      conn.disconnect();
      if (!m) meter.stop();
      if (signal.aborted) {
        pipeline?.dispose();
        tracker?.dispose();
      }
    }

    setRunning((r) => r && { ...r, phase: 'searching' });
    const search = store ? await workerSearch(store, SEARCH_QUERY) : naiveSearch(naiveSink.current?.getSegments() ?? [], SEARCH_QUERY);

    const samples = store ? tracker!.samples : latency;
    const [latP50, latP95] = samples.percentiles(50, 95) as [number, number];
    const rendered = store ? pipeline!.c.processed : (naiveSink.current?.rendered() ?? 0);
    const stateUpdates = store ? pipeline!.c.batches : (naiveSink.current?.updates() ?? 0);
    pipeline?.dispose();
    tracker?.dispose();
    return { ...m, config: cfg, received, rendered, stateUpdates, listCommits: stats.listCommits, rowCommits: stats.rowCommits, latP50, latP95, search };
  }

  async function run(variants: Variant[]) {
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const resumeLive = live.getSnapshot().state !== 'disconnected';
    if (resumeLive) live.disconnect();
    try {
      for (const v of variants) {
        const r = await runVariant(v, controller.signal);
        if (controller.signal.aborted) return;
        setResults((prev) => ({ ...prev, [v]: r }));
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setRunning(null);
      if (resumeLive) live.connect();
    }
  }

  const busy = running !== null;
  const naiveCapReason = 'Naive rendering mounts every row; seeds above 10K freeze the tab.';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl<SeedSize>
          label="Seed transcript"
          value={config.seed}
          onChange={(seed) => setConfig((c) => ({ ...c, seed }))}
          options={[1_000, 5_000, 10_000].map((n) => ({ value: n as SeedSize, label: `${n / 1000}K`, disabled: busy, title: naiveCapReason }))}
        />
        <SegmentedControl<StreamRate>
          label="Event rate (/s)"
          value={config.rate}
          onChange={(rate) => setConfig((c) => ({ ...c, rate }))}
          options={STREAM_RATES.map((r) => ({ value: r, label: String(r), disabled: busy }))}
        />
        <SegmentedControl<Seconds>
          label="Duration"
          value={config.seconds}
          onChange={(seconds) => setConfig((c) => ({ ...c, seconds }))}
          options={[5, 10, 20].map((s) => ({ value: s as Seconds, label: `${s} s`, disabled: busy }))}
        />
        <div className="flex gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => run(['A', 'B'])}>
            Run A then B
          </Button>
          <Button size="sm" disabled={busy} onClick={() => run(['A'])}>
            Run A
          </Button>
          <Button size="sm" disabled={busy} onClick={() => run(['B'])}>
            Run B
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Uses its own WebSocket connection and stops the server simulator when done. The main live feed is paused during a run and resumes (from its last ACK) afterwards. Seed rows and event content are synthetic <SourceBadge source="simulated" compact />; every measurement below is taken in this tab.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">{running ? `Running variant ${running.variant}` : 'Benchmark viewport'}</span>
            {running && <span className="font-mono text-slate-500">{running.phase}…</span>}
          </div>
          <div ref={containerRef} className="h-[360px] overflow-hidden rounded-md border border-slate-200 bg-white">
            {running?.variant === 'A' && <NaiveLiveList seed={running.seed} sinkRef={naiveSink} stats={running.stats} latency={running.latency} />}
            {running?.variant === 'B' && running.store && (
              <VirtualTranscriptList
                store={running.store}
                live
                activeIndex={-1}
                selectedId={null}
                matches={EMPTY}
                currentMatchRow={-1}
                query=""
                onSelect={noop}
                stats={running.stats}
              />
            )}
            {!running && <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-400">The variant under test is mounted here while it runs, then unmounted.</div>}
          </div>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
        <ResultsTable a={results.A} b={results.B} />
      </div>
    </div>
  );
}

/** `neutral` rows describe the run rather than score it. */
type Row = { label: string; hint: string; get: (r: AbResult) => number | null; fmt: (n: number) => string; better: 'lower' | 'higher' | 'neutral' };

const ms = (n: number) => `${formatMs(n)} ms`;
const int = (n: number) => formatNumber(n);

const ROWS: Row[] = [
  { label: 'Events received', hint: 'WebSocket frames during the run', get: (r) => r.received, fmt: int, better: 'neutral' },
  { label: 'Events rendered', hint: 'committed to the DOM', get: (r) => r.rendered, fmt: int, better: 'neutral' },
  { label: 'State updates requested', hint: 'A: setState per event · B: store notify per batch', get: (r) => r.stateUpdates, fmt: int, better: 'lower' },
  { label: 'Peak mounted rows', hint: 'transcript rows in the DOM', get: (r) => r.peakRows, fmt: int, better: 'lower' },
  { label: 'Peak DOM nodes', hint: 'inside the benchmark viewport', get: (r) => r.peakDomNodes, fmt: int, better: 'lower' },
  { label: 'List renders', hint: 'A: React merges queued setStates while a slow render blocks · B: batches + virtualiser scroll/measure', get: (r) => r.listCommits, fmt: int, better: 'neutral' },
  { label: 'Row renders', hint: 'committed row renders — the actual render work', get: (r) => r.rowCommits, fmt: int, better: 'lower' },
  { label: 'Event → render p50', hint: 'socket receive → commit', get: (r) => r.latP50, fmt: ms, better: 'lower' },
  { label: 'Event → render p95', hint: 'socket receive → commit', get: (r) => r.latP95, fmt: ms, better: 'lower' },
  { label: `Search “${SEARCH_QUERY}”`, hint: 'query → result', get: (r) => r.search.totalMs, fmt: ms, better: 'lower' },
  { label: 'Search main-thread time', hint: 'UI blocked by the search', get: (r) => r.search.mainThreadMs, fmt: ms, better: 'lower' },
  { label: 'FPS (avg)', hint: 'requestAnimationFrame', get: (r) => r.fpsAvg, fmt: (n) => n.toFixed(0), better: 'higher' },
  { label: 'FPS (worst second)', hint: 'requestAnimationFrame', get: (r) => r.fpsMin, fmt: (n) => n.toFixed(0), better: 'higher' },
  { label: 'Long tasks', hint: 'PerformanceObserver', get: (r) => r.longTasks, fmt: int, better: 'lower' },
  { label: 'Total blocking time', hint: 'Σ(long task − 50 ms)', get: (r) => r.blockingMs, fmt: ms, better: 'lower' },
];

function ResultsTable({ a, b }: { a: AbResult | undefined; b: AbResult | undefined }) {
  const cfg = (r: AbResult | undefined) => (r ? `${formatNumber(r.config.seed)} seed · ${r.config.rate}/s · ${r.config.seconds} s` : 'not run');
  const mismatch = a && b && (a.config.seed !== b.config.seed || a.config.rate !== b.config.rate || a.config.seconds !== b.config.seconds);
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Metric</th>
            <th className="px-3 py-2 font-medium">
              A · Naive <span className="block font-normal text-slate-400">all rows, setState per event · {cfg(a)}</span>
            </th>
            <th className="px-3 py-2 font-medium">
              B · Optimised <span className="block font-normal text-slate-400">virtualised, 50 ms batches · {cfg(b)}</span>
            </th>
            <th className="px-3 py-2 font-medium">B vs A</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const va = a ? row.get(a) : null;
            const vb = b ? row.get(b) : null;
            const both = va !== null && vb !== null && Number.isFinite(va) && Number.isFinite(vb);
            const ratio = both && va !== 0 ? vb / va : null;
            const neutral = row.better === 'neutral';
            const bBetter = both && (row.better === 'lower' ? vb < va : vb > va);
            const verdict = !both
              ? '—'
              : va === vb
                ? 'same'
                : vb === 0
                  ? 'none in B'
                  : va === 0
                    ? 'none in A'
                    : ratio! < 1
                      ? `${(1 / ratio!).toFixed(ratio! < 0.1 ? 0 : 1)}× lower`
                      : `${ratio!.toFixed(ratio! > 10 ? 0 : 1)}× higher`;
            return (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="px-3 py-1.5">
                  <span className="text-slate-800">{row.label}</span>
                  <span className="block text-[10px] text-slate-400">{row.hint}</span>
                </td>
                <td className="tabular px-3 py-1.5 font-mono text-slate-700">{va === null || !Number.isFinite(va) ? (a ? 'n/a' : '—') : row.fmt(va)}</td>
                <td className="tabular px-3 py-1.5 font-mono text-slate-700">{vb === null || !Number.isFinite(vb) ? (b ? 'n/a' : '—') : row.fmt(vb)}</td>
                <td className={cn('tabular px-3 py-1.5 font-mono whitespace-nowrap', !both || neutral || va === vb ? 'text-slate-500' : bBetter ? 'text-emerald-700' : 'text-red-700')}>{verdict}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <SourceBadge source="browser" /> measured in this tab
        {mismatch && <Badge tone="warning">A and B ran with different settings — re-run both to compare</Badge>}
      </div>
    </div>
  );
}
