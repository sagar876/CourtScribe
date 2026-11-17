import { cn } from '../../lib/cn.ts';

export function ProgressBar({ value, max, label, tone = 'accent' }: { value: number; max: number; label: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={cn('h-full rounded-full transition-[width] duration-200', { accent: 'bg-accent-600', success: 'bg-emerald-600', warning: 'bg-amber-500', danger: 'bg-red-600' }[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
