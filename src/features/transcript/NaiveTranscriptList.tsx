import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { TranscriptRowView } from './TranscriptRow.tsx';
import { containsSorted } from './searchCore.ts';
import { getNoActive, noopSubscribe, type TranscriptListProps } from './listTypes.ts';

/**
 * Deliberately naive baseline for comparison: every segment is mounted, rows
 * are not memoised and receive fresh callbacks, so any state change re-renders
 * the whole list. Capped by the caller to keep the tab usable.
 */
export function NaiveTranscriptList({ store, live, activeIndex, selectedId, matches, currentMatchRow, query, onSelect, stats, playback, ref }: TranscriptListProps) {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    stats.listCommits++;
  });

  // Report which store version is now in the DOM (event → render latency).
  useLayoutEffect(() => store.markCommitted(version), [store, version]);
  useEffect(() => store.attachView(), [store]);

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      scrollRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'center' });
    },
    element: () => scrollRef.current,
  }));

  const playbackActiveId = useSyncExternalStore(playback?.subscribeActive ?? noopSubscribe, playback?.getActiveId ?? getNoActive);
  const playbackIndex = playbackActiveId ? store.indexOf(playbackActiveId) : -1;
  const effectiveActive = playbackIndex >= 0 ? playbackIndex : activeIndex >= 0 ? activeIndex : live ? store.size - 1 : -1;
  const rows = [];
  for (let i = 0; i < store.size; i++) {
    const segment = store.at(i)!;
    const isMatch = containsSorted(matches, i);
    rows.push(
      <div key={segment.id} data-index={i}>
        <TranscriptRowView
          segment={segment}
          index={i}
          isActive={i === effectiveActive}
          isSelected={segment.id === selectedId}
          isMatch={isMatch}
          isCurrentMatch={i === currentMatchRow}
          highlight={query}
          onSelect={(id, idx) => onSelect(id, idx)}
          stats={stats}
        />
      </div>,
    );
  }

  return (
    <div ref={scrollRef} role="listbox" aria-label="Transcript (naive)" className="h-full overflow-auto">
      {rows}
    </div>
  );
}
