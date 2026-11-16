import type { ReactNode } from 'react';

export function KeyValueGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{it.label}</dt>
          <dd className="mt-1 truncate text-sm font-medium text-slate-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
