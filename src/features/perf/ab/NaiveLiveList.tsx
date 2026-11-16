import { useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../../../shared/transcript.ts';
import type { SampleWindow } from '../../../lib/stats.ts';
import { TranscriptRowView } from '../../transcript/TranscriptRow.tsx';
import type { ViewerStats } from '../../transcript/renderStats.ts';

export interface NaiveSink {
  push: (segment: TranscriptSegment, receivedAt: number) => void;
  getSegments: () => TranscriptSegment[];
  rendered: () => number;
  /** setState calls issued (one per incoming event). */
  updates: () => number;
}

interface Props {
  seed: TranscriptSegment[];
  sinkRef: React.RefObject<NaiveSink | null>;
  stats: ViewerStats;
  latency: SampleWindow;
}

const noop = () => {};

/**
 * Variant A — the deliberately naive implementation, used only by the A/B bench:
 * transcript held in React state as one array, a setState (with an O(n) copy)
 * for every incoming WebSocket event, every row mounted, no memoisation.
 */
export function NaiveLiveList({ seed, sinkRef, stats, latency }: Props) {
  const [segments, setSegments] = useState(seed);
  const segmentsRef = useRef(segments);
  const pending = useRef<number[]>([]);
  const rendered = useRef(0);
  const updates = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    sinkRef.current = {
      push: (segment, receivedAt) => {
        pending.current.push(receivedAt);
        updates.current++;
        setSegments((prev) => {
          const i = prev.findIndex((s) => s.id === segment.id);
          if (i < 0) return [...prev, segment];
          const next = prev.slice();
          next[i] = segment;
          return next;
        });
      },
      getSegments: () => segmentsRef.current,
      rendered: () => rendered.current,
      updates: () => updates.current,
    };
    return () => {
      sinkRef.current = null;
    };
  }, [sinkRef]);

  // After every commit: sample event → render latency and follow the newest row.
  useLayoutEffect(() => {
    segmentsRef.current = segments;
    stats.listCommits++;
    if (pending.current.length) {
      const now = performance.now();
      for (const r of pending.current) latency.add(now - r);
      rendered.current += pending.current.length;
      pending.current = [];
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      {segments.map((s, i) => (
        <TranscriptRowView key={s.id} segment={s} index={i} isActive={i === segments.length - 1} isSelected={false} isMatch={false} isCurrentMatch={false} highlight="" onSelect={noop} stats={stats} />
      ))}
    </div>
  );
}
