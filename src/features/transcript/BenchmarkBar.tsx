import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatMs, formatNumber } from '../../lib/format.ts';
import { useMonitorCommit } from '../perf/monitorRenders.ts';
import { resetViewerStats, type ViewerStats } from './renderStats.ts';

interface Sample {
  rowCommits: number;
  listCommits: number;
  lastCommitMs: number;
  avgCommitMs: number;
}

/** Render cost of the transcript list. Polls counters at 4 Hz — reading metrics never re-renders the transcript. */
export function BenchmarkBar({ stats, extra }: { stats: ViewerStats; extra?: ReactNode }) {
  useMonitorCommit();
  const [s, setS] = useState<Sample | null>(null);

  useEffect(() => {
    const read = () =>
      setS((prev) => {
        const next = {
          rowCommits: stats.rowCommits,
          listCommits: stats.listCommits,
          lastCommitMs: stats.lastCommitMs,
          avgCommitMs: stats.profiledCommits ? stats.totalCommitMs / stats.profiledCommits : NaN,
        };
        // Skip the render entirely when nothing changed.
        return prev && prev.rowCommits === next.rowCommits && prev.listCommits === next.listCommits && Object.is(prev.lastCommitMs, next.lastCommitMs) ? prev : next;
      });
    read();
    const t = setInterval(read, 250);
    return () => clearInterval(t);
  }, [stats]);

  if (!s) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
