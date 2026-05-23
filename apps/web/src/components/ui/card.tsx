import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...p }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-bg-card border border-border rounded-lg overflow-hidden',
      className,
    )}
    {...p}
  />
));
Card.displayName = 'Card';

export const CardHeader = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'px-6 pt-5 pb-3 flex items-center justify-between gap-3',
      className,
    )}
    {...p}
  />
);

export const CardTitle = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn('text-[15px] font-semibold tracking-tight', className)}
    {...p}
  />
);

export const CardBody = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-6 py-5', className)} {...p} />
);

export const CardFooter = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'px-6 py-4 border-t border-border bg-bg-subtle flex items-center justify-end gap-2.5',
      className,
    )}
    {...p}
  />
);
