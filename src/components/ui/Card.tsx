import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { InfoTip } from './InfoTip.tsx';

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Plain-language explanation shown behind an "i" button next to the title. */
  info?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Card({ title, description, actions, info, children, className, bodyClassName }: CardProps) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                {title}
                {info && typeof title === 'string' && <InfoTip label={title}>{info}</InfoTip>}
              </h2>
            )}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
