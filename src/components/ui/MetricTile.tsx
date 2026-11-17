import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { InfoTip } from './InfoTip.tsx';
import { SourceBadge, type MetricSource } from './SourceBadge.tsx';

interface MetricTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  source?: MetricSource;
  tone?: 'default' | 'warning' | 'danger' | 'good';
  className?: string;
  /** What it measures, why it matters, how to read it — shown behind an "i". */
  info?: ReactNode;
}

const valueTone = {
  default: 'text-slate-900',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

export function MetricTile({ label, value, unit, hint, source, tone = 'default', className, info }: MetricTileProps) {
  return (
    <div data-metric={label} className={cn('flex min-w-0 flex-col rounded-md border border-slate-200 bg-white px-3 py-2.5', className)}>
      {/* Whole words only: when space runs out the badge wraps to its own line instead of splitting the label. */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-[11px] leading-tight font-medium tracking-wide text-slate-600 uppercase">
          {label}
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </span>
        {source && <SourceBadge source={source} compact />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn('tabular font-mono text-lg font-medium', valueTone[tone])}>{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500" title={typeof hint === 'string' ? hint : undefined}>{hint}</div>}
    </div>
  );
}
