'use client';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap overflow-hidden ' +
    'rounded-sm border-[1.5px] border-transparent font-medium ' +
    'transition-all duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)] ' +
    'disabled:opacity-55 disabled:cursor-not-allowed ' +
    '[&_svg]:w-3.5 [&_svg]:h-3.5',
  {
    variants: {
      variant: {
        grad:
          'text-white font-semibold shadow-a bg-grad ' +
          'hover:-translate-y-px hover:shadow-[0_12px_32px_rgba(99,102,241,.36)] active:translate-y-0',
        primary:
          'bg-accent text-white border-accent hover:bg-accent-600 hover:border-accent-600 hover:-translate-y-px',
        success:
          'bg-green text-white border-green hover:bg-[#059669] hover:border-[#059669]',
        danger:
          'bg-red text-white border-red hover:bg-[#dc2626] hover:border-[#dc2626]',
        outline:
          'bg-bg-card text-text border-border hover:border-accent hover:text-accent hover:bg-accent-50',
        ghost:
          'bg-transparent text-text-sub border-transparent hover:bg-bg-hover hover:text-text',
      },
      size: {
        sm: 'px-3 py-[5px] text-[12px]',
        md: 'px-4 py-2 text-[13px]',
        lg: 'px-5 py-[11px] text-[14px] font-semibold',
        xs: 'px-2.5 py-1 text-[11px] rounded-sm',
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
  ({ className, variant, size, full, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size, full }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
