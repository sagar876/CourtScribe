import { memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { TranscriptSegment } from '../../../shared/transcript.ts';
import { cn } from '../../lib/cn.ts';
import { formatTimestamp } from '../../lib/format.ts';
import type { ViewerStats } from './renderStats.ts';
import { SPEAKER_STYLE } from './speakers.ts';

export interface TranscriptRowProps {
  segment: TranscriptSegment;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  isMatch: boolean;
  isCurrentMatch: boolean;
  /** Only passed when the row matches, so typing doesn't re-render non-matching rows. */
  highlight: string;
  onSelect: (id: string, index: number) => void;
  stats: ViewerStats;
}

function highlightText(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-200/80 px-0.5 text-inherit">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** Plain (un-memoised) row. Used directly by the naive list. */
export function TranscriptRowView({ segment, index, isActive, isSelected, isMatch, isCurrentMatch, highlight, onSelect, stats }: TranscriptRowProps) {
  const commits = useRef(0);
  const counterEl = useRef<HTMLSpanElement>(null);

  // Runs once per committed render of this row; updates the badge without re-rendering.
  useLayoutEffect(() => {
    commits.current++;
    stats.rowCommits++;
    if (counterEl.current) counterEl.current.textContent = `×${commits.current}`;
  });

  const lowConfidence = segment.confidence < 0.8;

  return (
    <div
      data-transcript-row=""
      role="option"
      aria-selected={isSelected}
      aria-label={`${formatTimestamp(segment.startTime)}, ${segment.speakerName}: ${segment.text}${segment.isPartial ? ' (interim)' : ''}`}
      tabIndex={0}
      onClick={() => onSelect(segment.id, index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(segment.id, index);
        }
      }}
      className={cn(
        'group grid cursor-pointer grid-cols-[84px_1fr] gap-x-3 border-b border-slate-100 px-4 py-2.5 text-sm sm:grid-cols-[84px_150px_1fr_auto]',
        isSelected ? 'bg-accent-50' : isActive ? 'bg-amber-50/70' : isCurrentMatch ? 'bg-amber-50' : 'hover:bg-slate-50',
        isActive && 'shadow-[inset_3px_0_0_0] shadow-amber-500',
        isSelected && 'shadow-[inset_3px_0_0_0] shadow-accent-600',
      )}
    >
      <span className="tabular pt-0.5 font-mono text-xs text-slate-500">{formatTimestamp(segment.startTime)}</span>
      <span className="col-start-2 sm:col-start-auto">
        <span className={cn('inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium', SPEAKER_STYLE[segment.speakerId])}>{segment.speakerName}</span>
      </span>
      <p className={cn('col-start-2 font-transcript leading-relaxed sm:col-start-auto', segment.isPartial ? 'text-slate-500 italic' : 'text-slate-800')}>
        {isMatch ? highlightText(segment.text, highlight) : segment.text}
      </p>
      <span className="col-start-2 flex items-center gap-2 pt-0.5 sm:col-start-auto sm:flex-col sm:items-end sm:gap-0.5">
        <span
          className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', segment.isPartial ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-slate-100 text-slate-700')}
          title={segment.isPartial ? 'Still being recognised — the text may change' : 'Final result'}
        >
          {segment.isPartial ? 'Interim' : 'Final'}
        </span>
        {segment.confidence > 0 && (
          <span data-diagnostic="" title={segment.speakerId === 'mic' ? 'Recogniser confidence' : 'Synthetic confidence score'} className={cn('tabular font-mono text-[11px]', lowConfidence ? 'text-amber-700' : 'text-slate-500')}>
            {(segment.confidence * 100).toFixed(0)}%
          </span>
        )}
        <span ref={counterEl} data-diagnostic="" title="Commits of this row component" className="tabular rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500" />
      </span>
    </div>
  );
}

/** Memoised row: re-renders only when its own segment or flags change. */
export const TranscriptRow = memo(TranscriptRowView);
