import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { formatNumber, parseTimestamp } from '../../lib/format.ts';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatch: number;
  pending: boolean;
  onStep: (dir: 1 | -1) => void;
  onJump: (ms: number) => void;
}

export function TranscriptToolbar({ query, onQueryChange, matchCount, currentMatch, pending, onStep, onJump }: Props) {
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);

  const submitJump = (e: FormEvent) => {
    e.preventDefault();
    const ms = parseTimestamp(jump);
    if (ms === null) {
      setJumpError('Use hh:mm:ss, mm:ss or seconds');
      return;
    }
    setJumpError(null);
    onJump(ms);
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2.5">
      <div className="flex min-w-[260px] flex-1 items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search transcript</span>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onStep(e.shiftKey ? -1 : 1);
            }}
            placeholder="Search speaker or text (e.g. Exhibit P3, സാക്ഷി)"
            className="h-8 w-full rounded-md border border-slate-300 bg-white pr-2 pl-8 text-sm placeholder:text-slate-400 focus:border-accent-500 focus:outline-none"
          />
        </label>
        <span className="tabular w-24 shrink-0 text-right font-mono text-xs text-slate-500" aria-live="polite">
          {pending ? 'searching…' : hasQuery ? (matchCount ? `${formatNumber(currentMatch + 1)} / ${formatNumber(matchCount)}` : 'no matches') : ''}
        </span>
        <Button size="sm" variant="secondary" aria-label="Previous match" disabled={!matchCount} onClick={() => onStep(-1)} icon={<Icon name="chevronUp" className="size-3.5" />} />
        <Button size="sm" variant="secondary" aria-label="Next match" disabled={!matchCount} onClick={() => onStep(1)} icon={<Icon name="chevronDown" className="size-3.5" />} />
      </div>
      <form onSubmit={submitJump} className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <Icon name="clock" className="size-4 text-slate-400" />
          <span className="sr-only sm:not-sr-only">Jump to</span>
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            placeholder="hh:mm:ss"
            aria-invalid={jumpError !== null}
            className="tabular h-8 w-24 rounded-md border border-slate-300 bg-white px-2 font-mono text-sm text-slate-800 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none aria-invalid:border-red-400"
          />
        </label>
        <Button size="sm" type="submit" disabled={!jump.trim()}>
          Go
        </Button>
        {jumpError && <span className="text-xs text-red-600">{jumpError}</span>}
      </form>
    </div>
  );
}
