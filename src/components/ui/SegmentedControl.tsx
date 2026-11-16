import { cn } from '../../lib/cn.ts';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown as a tooltip; use it to explain why an option is disabled. */
  title?: string;
}

interface Props<T extends string | number> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string | number>({ label, options, value, onChange, size = 'sm' }: Props<T>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-md border border-slate-300 bg-slate-100 p-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={o.disabled}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded px-2.5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
                active ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
