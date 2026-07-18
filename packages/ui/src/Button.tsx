'use client';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

/**
 * The product's button (docs/plan/02-design-system.md §2.2).
 *
 * Changes from the pre-v2 button, all deliberate:
 * - md is 30px, not ~34px; lg is 36px, not 40px.
 * - 1px borders, not 1.5px — a hairline reads as precision at this density.
 * - No `hover:-translate-y-px`. A button that lifts is charming once; it is
 *   noise on a toolbar with nine of them.
 * - Focus is the shared ring from tokens.css, never a colour swap.
 * - No gradient variant. `--grad` stays for decoration (hero wash, unread dot),
 *   but a primary action is solid `--a`: a three-stop gradient on a 30px control
 *   competes with the content it sits above, and never matched the neighbouring
 *   Select/Input borders.
 *
 * The variant/size names match what apps/web already calls, so adopting this
 * changed no call sites.
 */
const button = cva(
  'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap ' +
    'rounded-md border border-transparent font-medium select-none ' +
    'transition-colors duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)] ' +
    'disabled:opacity-50 disabled:pointer-events-none ' +
    '[&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white border-accent hover:bg-accent-600 hover:border-accent-600',
        success:
          'bg-green text-white border-green hover:bg-[#059669] hover:border-[#059669]',
        danger: 'bg-red text-white border-red hover:bg-[#dc2626] hover:border-[#dc2626]',
        outline:
          'bg-bg-card text-text border-border hover:border-border-strong hover:bg-bg-hover',
        ghost:
          'bg-transparent text-text-sub border-transparent hover:bg-bg-hover hover:text-text',
        subtle:
          'bg-bg-subtle text-text-sub border-transparent hover:bg-bg-hover hover:text-text',
        /** Alias of `subtle`, kept because apps/admin already calls it. */
        secondary:
          'bg-bg-subtle text-text border-border hover:bg-bg-hover hover:border-border-strong',
      },
      size: {
        xs: 'h-ctl-xs px-1.5 text-2xs gap-1 [&_svg]:w-3 [&_svg]:h-3',
        sm: 'h-ctl-sm px-2 text-xs',
        md: 'h-ctl-md px-2.5 text-sm',
        lg: 'h-ctl-lg px-3.5 text-sm font-semibold [&_svg]:w-4 [&_svg]:h-4',
      },
      full: { true: 'w-full' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // A bare <button> in a form defaults to submit, which has surprised
        // enough people to be worth an explicit default here.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(button({ variant, size, full }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export interface IconButtonProps extends Omit<ButtonProps, 'full'> {
  /** Required: an icon-only control is unlabelled to a screen reader without it. */
  'aria-label': string;
}

/** Square button for a single icon — same heights, no text padding. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = 'md', variant = 'ghost', ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        'px-0 aspect-square',
        size === 'xs' && 'w-ctl-xs',
        size === 'sm' && 'w-ctl-sm',
        size === 'md' && 'w-ctl-md',
        size === 'lg' && 'w-ctl-lg',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

export { button as buttonVariants };
