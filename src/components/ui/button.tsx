'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * §12 Button. Four variants, three sizes, and a loading state that does not
 * reflow.
 *
 * §12: "Loading replaces the label with a spinner **at preserved width**, so
 * nothing reflows." A button that shrinks mid-submit moves everything beside
 * it, and on a toolbar that is every other control.
 *
 * The width is preserved by *layout*, not by measurement: the label stays in
 * the box and is made invisible, and the spinner is overlaid on top of it. The
 * measuring version — read the rendered width, pin it in a style — has to touch
 * a ref during render, which React 19 rightly refuses, and it gets the wrong
 * answer on the first render anyway because there is nothing to measure yet.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // Navy fill. Sky is ~2.4:1 on Ivory and fails AA for text — it is for fills
  // and accents, never for a label the user has to read (§12).
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-hover',
  ghost: 'bg-transparent text-text border border-transparent hover:bg-surface-hover',
  danger: 'bg-danger text-danger-fg border border-transparent hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-8 px-3 text-sm gap-2 rounded-sm',
  lg: 'h-10 px-4 text-sm gap-2 rounded-md',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      // Announced, not merely shown: a spinner is invisible to a screen reader,
      // and "did my click register" is the question it answers.
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center font-medium',
        'transition-colors duration-120 ease-[var(--ease-out-soft)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {/* `invisible` rather than conditional rendering: the label keeps its
          place in the layout, which is the whole point. */}
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {children}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 aria-hidden className="size-4 animate-spin" />
        </span>
      )}
    </button>
  );
}
