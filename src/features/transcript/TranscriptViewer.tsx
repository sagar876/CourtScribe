import { Profiler, useCallback, useEffect, useRef, useState, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { BenchmarkBar } from './BenchmarkBar.tsx';
import { NaiveTranscriptList } from './NaiveTranscriptList.tsx';
import { SegmentDetails } from './SegmentDetails.tsx';
import { TranscriptToolbar } from './TranscriptToolbar.tsx';
import type { TranscriptStore } from './TranscriptStore.ts';
import { VirtualTranscriptList } from './VirtualTranscriptList.tsx';
import type { ListHandle, PlaybackSync, ViewerProbe } from './listTypes.ts';
import { createViewerStats, type ViewerStats } from './renderStats.ts';
import { useTranscriptSearch, type SearchEngine } from './useTranscriptSearch.ts';

export type RenderMode = 'virtual' | 'naive';

interface TranscriptViewerProps {
  store: TranscriptStore;
  live?: boolean;
  renderMode?: RenderMode;
  searchEngine?: SearchEngine;
  showBenchmark?: boolean;
  benchmarkExtra?: ReactNode;
  /** Height of the scrolling list area. */
  listClassName?: string;
  stats?: ViewerStats;
  /** Optional media player: drives the active segment; clicking a segment seeks to it. */
  playback?: PlaybackSync;
  /** Dashboards read dataset size, mounted rows and last search from here. */
  probe?: ViewerProbe;
}

/**
 * Transcript viewer. State is isolated here (query, selection, active cursor);
 * the transcript itself lives in the store and is never copied into React state.
 */
export function TranscriptViewer({ store, live = false, renderMode = 'virtual', searchEngine = 'worker', showBenchmark = false, benchmarkExtra, listClassName = 'h-[560px]', stats: externalStats, playback, probe }: TranscriptViewerProps) {
  const [ownStats] = useState(createViewerStats);
  const stats = externalStats ?? ownStats;
  const listRef = useRef<ListHandle>(null);
  const [query, setQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { result, matches, pending } = useTranscriptSearch(store, searchEngine, query);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const segment = playback ? store.get(id) : undefined;
      if (segment) playback?.seekMs(segment.startTime);
    },
    [store, playback],
  );

  useEffect(() => {
    if (!probe) return;
    probe.store = store;
    probe.list = listRef.current;
    return () => {
      probe.store = null;
      probe.list = null;
      probe.search = null;
    };
  }, [probe, store, renderMode]);
  useEffect(() => {
    if (probe) probe.search = result;
  }, [probe, result]);

  // New query → first match. Live re-searches of the same query keep the reader's place.
  const [matchedQuery, setMatchedQuery] = useState<string | null>(null);
  const resultQuery = result?.query ?? null;
  if (resultQuery !== matchedQuery) {
    setMatchedQuery(resultQuery);
    setCurrentMatch(0);
  }
  useEffect(() => {
    const first = result?.matches[0];
    if (first !== undefined) listRef.current?.scrollToIndex(first);
    // Scroll only when the query changes, not on every live re-search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultQuery]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!matches.length) return;
      setCurrentMatch((c) => {
        const next = (c + dir + matches.length) % matches.length;
        const row = matches[next];
        if (row !== undefined) listRef.current?.scrollToIndex(row);
        return next;
      });
    },
    [matches],
  );

  const jump = useCallback(
    (ms: number) => {
      const index = store.indexAtTime(ms);
      if (index < 0) return;
      // With audio loaded the player owns the active segment; otherwise mark it locally.
      if (!playback?.seekMs(ms)) setActiveIndex(index);
      listRef.current?.scrollToIndex(index);
    },
    [store, playback],
  );

  const onRender = useCallback<ProfilerOnRenderCallback>(
    (_id, _phase, actualDuration) => {
      stats.lastCommitMs = actualDuration;
      stats.totalCommitMs += actualDuration;
      stats.profiledCommits++;
    },
    [stats],
  );

  const currentMatchRow = matches[Math.min(currentMatch, matches.length - 1)] ?? -1;
  const List = renderMode === 'virtual' ? VirtualTranscriptList : NaiveTranscriptList;

  return (
    <div className="flex flex-col gap-3">
      {showBenchmark && <BenchmarkBar stats={stats} extra={benchmarkExtra} />}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <TranscriptToolbar query={query} onQueryChange={setQuery} matchCount={matches.length} currentMatch={currentMatch} pending={pending} onStep={step} onJump={jump} />
        <div className={cn('relative', listClassName)}>
          <Profiler id="transcript-list" onRender={onRender}>
            <List
              ref={listRef}
              store={store}
              live={live}
              activeIndex={activeIndex}
              selectedId={selectedId}
              matches={matches}
              currentMatchRow={currentMatchRow}
              query={result?.query ?? ''}
              onSelect={onSelect}
              stats={stats}
              playback={playback}
            />
          </Profiler>
        </div>
        <SegmentDetails store={store} selectedId={selectedId} onClear={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
