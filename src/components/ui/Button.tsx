import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /**
   * Marks a feature as not implemented. The button is disabled and the reason
   * is exposed visually (tooltip) and to assistive tech.
   */
  unavailableReason?: string;
}

const variants: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 border border-navy-900',
  secondary: 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent',
  danger: 'bg-white text-red-700 hover:bg-red-50 border border-red-200',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export function Button({ variant = 'secondary', size = 'md', icon, unavailableReason, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const reasonId = useId();
  const isDisabled = disabled || unavailableReason !== undefined;
  return (
    <>
      <button
        type={type}
        disabled={isDisabled}
        title={unavailableReason ?? rest.title}
        aria-describedby={unavailableReason ? reasonId : undefined}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-inherit',
          unavailableReason && 'border-dashed',
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
      {unavailableReason && (
        <span id={reasonId} className="sr-only">
          {unavailableReason}
        </span>
      )}
    </>
  );
}
