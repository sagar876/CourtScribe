import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatMs, formatNumber } from '../../lib/format.ts';
import type { TranscriptStore } from './TranscriptStore.ts';
import type { ListHandle } from './listTypes.ts';
import { resetViewerStats, type ViewerStats } from './renderStats.ts';
import type { SearchResult } from './useTranscriptSearch.ts';

interface Sample {
  size: number;
  mountedRows: number;
  rowCommits: number;
  listCommits: number;
  lastCommitMs: number;
  avgCommitMs: number;
}

/** Polls counters at 4 Hz — reading metrics never re-renders the transcript. */
export function BenchmarkBar({ store, listRef, stats, search, extra }: { store: TranscriptStore; listRef: React.RefObject<ListHandle | null>; stats: ViewerStats; search: SearchResult | null; extra?: ReactNode }) {
  const [s, setS] = useState<Sample | null>(null);

  useEffect(() => {
    const read = () =>
      setS({
        size: store.size,
        mountedRows: listRef.current?.element()?.querySelectorAll('[data-transcript-row]').length ?? 0,
        rowCommits: stats.rowCommits,
        listCommits: stats.listCommits,
        lastCommitMs: stats.lastCommitMs,
        avgCommitMs: stats.profiledCommits ? stats.totalCommitMs / stats.profiledCommits : NaN,
      });
    read();
    const t = setInterval(read, 250);
    return () => clearInterval(t);
  }, [store, listRef, stats]);

  if (!s) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Dataset size" value={formatNumber(s.size)} unit="segments" source="browser" />
        <MetricTile
          label="Mounted DOM rows"
          value={formatNumber(s.mountedRows)}
          hint={s.size ? `${((s.mountedRows / s.size) * 100).toFixed(s.mountedRows / s.size < 0.01 ? 3 : 1)}% of dataset` : undefined}
          tone={s.mountedRows > 2_000 ? 'danger' : 'good'}
          source="browser"
        />
        <MetricTile
          label="Search duration"
          value={search ? formatMs(search.totalMs) : '—'}
          unit={search ? 'ms' : undefined}
          hint={search ? `${search.engine === 'worker' ? 'worker scan' : 'main-thread scan'} ${formatMs(search.computeMs)} ms · ${formatNumber(search.matches.length)} hits` : 'Type a query to measure'}
          tone={search && search.engine === 'main-thread' && search.totalMs > 50 ? 'warning' : 'default'}
          source="browser"
        />
        <MetricTile label="Row renders" value={formatNumber(s.rowCommits)} hint="committed row renders since reset" source="browser" />
        <MetricTile label="List renders" value={formatNumber(s.listCommits)} hint="committed list renders since reset" source="browser" />
        <MetricTile
          label="Last list commit"
          value={formatMs(s.lastCommitMs)}
          unit={Number.isFinite(s.lastCommitMs) ? 'ms' : undefined}
          hint={Number.isFinite(s.avgCommitMs) ? `avg ${formatMs(s.avgCommitMs)} ms (React Profiler)` : 'React Profiler · dev builds only'}
          source="browser"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">{extra}</div>
        <Button size="sm" variant="ghost" onClick={() => resetViewerStats(stats)}>
          Reset render counters
        </Button>
      </div>
    </div>
  );
}
