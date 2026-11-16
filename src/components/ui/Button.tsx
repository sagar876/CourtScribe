import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn.ts';

/**
 * primary — the main action in a group · secondary — other actions · ghost — low-emphasis inline actions
 * danger — destructive/disruptive (outlined) · record — start audio capture (solid red)
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'record';
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
  // Hover only applies to enabled buttons (`enabled:`), so it never fights the disabled style.
  primary: 'border border-navy-900 bg-navy-900 text-white enabled:hover:bg-navy-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 enabled:hover:bg-slate-50',
  ghost: 'border border-transparent bg-transparent text-slate-700 enabled:hover:bg-slate-100',
  danger: 'border border-red-300 bg-white text-red-700 enabled:hover:bg-red-50',
  record: 'border border-red-700 bg-red-700 text-white enabled:hover:bg-red-800',
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
          variants[variant],
          sizes[size],
          // Disabled = explicit readable colours (not faded opacity) + not-allowed cursor; unavailable features also get a dashed border.
          'disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500',
          unavailableReason && 'border-dashed disabled:border-slate-300',
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
