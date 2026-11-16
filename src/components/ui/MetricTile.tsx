import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { SourceBadge, type MetricSource } from './SourceBadge.tsx';

interface MetricTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  source?: MetricSource;
  tone?: 'default' | 'warning' | 'danger' | 'good';
  className?: string;
}

const valueTone = {
  default: 'text-slate-900',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

export function MetricTile({ label, value, unit, hint, source, tone = 'default', className }: MetricTileProps) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-md border border-slate-200 bg-white px-3 py-2.5', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</span>
        {source && <SourceBadge source={source} compact />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn('tabular font-mono text-lg font-medium', valueTone[tone])}>{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}
