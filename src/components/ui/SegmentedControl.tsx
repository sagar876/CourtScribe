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
  /** Shown beside the label when every option is disabled, so the reason is not conveyed by colour alone. */
  disabledHint?: string;
}

export function SegmentedControl<T extends string | number>({ label, options, value, onChange, size = 'sm', disabledHint }: Props<T>) {
  const allDisabled = options.length > 0 && options.every((o) => o.disabled);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">
        {label}
        {allDisabled && disabledHint && <span className="ml-1.5 font-normal tracking-normal normal-case text-slate-500">· {disabledHint}</span>}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        aria-disabled={allDisabled || undefined}
        className={cn('inline-flex max-w-full flex-wrap rounded-md border bg-slate-100 p-0.5', allDisabled ? 'border-dashed border-slate-300' : 'border-slate-300')}
      >
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
                'rounded px-2.5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
                size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
                // The selected option keeps a visible frame even when disabled, so the current value stays readable.
                active ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-300 disabled:text-slate-600' : 'text-slate-700 enabled:hover:bg-white/60 enabled:hover:text-slate-900 disabled:text-slate-500',
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
