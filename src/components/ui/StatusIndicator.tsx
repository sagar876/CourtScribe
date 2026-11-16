import { cn } from '../../lib/cn.ts';
import type { Tone } from './Badge.tsx';

const dot: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-accent-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

export function StatusIndicator({ tone, label, pulse = false, className }: { tone: Tone; label: string; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium text-slate-800', className)} role="status">
      <span className="relative flex size-2.5">
        {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dot[tone])} />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', dot[tone])} />
      </span>
      {label}
    </span>
  );
}
