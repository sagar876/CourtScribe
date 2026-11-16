import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from '../../components/ui/Icon.tsx';
import { TranscriptRow } from './TranscriptRow.tsx';
import { containsSorted } from './searchCore.ts';
import type { TranscriptListProps } from './listTypes.ts';

const FOLLOW_THRESHOLD_PX = 80;

/**
 * Virtualised transcript list. Only visible rows (+ overscan) are mounted.
 * When live: follows new segments while the reader is at the bottom; once the
 * reader scrolls up, the position is held and new arrivals are counted instead.
 */
export function VirtualTranscriptList({ store, live, activeIndex, selectedId, matches, currentMatchRow, query, onSelect, stats, ref }: TranscriptListProps) {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const count = store.size;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 6,
    getItemKey: (i) => store.idAt(i),
  });

  const followingRef = useRef(live);
  const [following, setFollowing] = useState(live);
  // Row count when the reader stopped following; "new segments" is derived from it, so arrivals cause no extra state updates.
  const [unfollowedAt, setUnfollowedAt] = useState(count);
  const unseen = live && !following ? Math.max(0, count - unfollowedAt) : 0;

  useLayoutEffect(() => {
    stats.listCommits++;
  });

  // Report which store version is now in the DOM (event → render latency).
  useLayoutEffect(() => store.markCommitted(version), [store, version]);
  useEffect(() => store.attachView(), [store]);

  // A live transcript that already has content opens at the newest segment.
  useLayoutEffect(() => {
    if (live && store.size > 0) virtualizer.scrollToIndex(store.size - 1, { align: 'end' });
    // Mount-only: later arrivals are handled by the follow logic below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Following: stay pinned on any change (new rows, or the last partial row growing).
  useLayoutEffect(() => {
    if (followingRef.current && live && count > 0) virtualizer.scrollToIndex(count - 1, { align: 'end' });
  }, [version, count, live, virtualizer]);

  const setFollow = (next: boolean) => {
    if (next === followingRef.current) return;
    followingRef.current = next;
    setFollowing(next);
    if (!next) setUnfollowedAt(store.size);
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        setFollow(false);
        virtualizer.scrollToIndex(index, { align: 'center' });
      },
      element: () => scrollRef.current,
    }),
    [virtualizer],
  );

  const onScroll = () => {
    if (!live) return;
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX);
  };

  const jumpToLatest = () => {
    setFollow(true);
    virtualizer.scrollToIndex(count - 1, { align: 'end' });
  };

  const effectiveActive = activeIndex >= 0 ? activeIndex : live && following ? count - 1 : -1;
  const items = virtualizer.getVirtualItems();

  return (
    <div className="relative h-full">
      <div ref={scrollRef} onScroll={onScroll} role="listbox" aria-label="Transcript" className="h-full overflow-auto overscroll-contain [contain:strict]">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {items.map((vi) => {
            const segment = store.at(vi.index);
            if (!segment) return null;
            const isMatch = matches.length > 0 && containsSorted(matches, vi.index);
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                <TranscriptRow
                  segment={segment}
                  index={vi.index}
                  isActive={vi.index === effectiveActive}
                  isSelected={segment.id === selectedId}
                  isMatch={isMatch}
                  isCurrentMatch={vi.index === currentMatchRow}
                  highlight={isMatch ? query : ''}
                  onSelect={onSelect}
                  stats={stats}
                />
              </div>
            );
          })}
        </div>
      </div>
      {count === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {live ? 'Waiting for live transcript segments…' : 'No segments loaded.'}
        </div>
      )}
      {live && !following && unseen > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-navy-800"
        >
          <Icon name="arrowDown" className="size-3.5" />
          {unseen.toLocaleString('en-IN')} new segment{unseen === 1 ? '' : 's'} — follow live
        </button>
      )}
    </div>
  );
}
