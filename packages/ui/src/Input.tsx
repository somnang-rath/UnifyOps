'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * Text inputs (docs/plan/02-design-system.md §2.2).
 *
 * 30px tall, 1px border, 13px text — the same metrics as Button so a form row
 * and a toolbar row line up without per-screen nudging. The focus ring comes
 * from tokens.css; there is no separate focus shadow here.
 */
const base =
  'w-full rounded-md border border-border bg-bg-input text-text text-sm outline-none ' +
  'placeholder:text-text-muted ' +
  'transition-colors duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)] ' +
  'hover:border-border-strong focus:border-accent ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-bg-subtle ' +
  'aria-[invalid=true]:border-red';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(base, 'h-ctl-md px-2.5', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(base, 'px-2.5 py-1.5 resize-y min-h-16 leading-[1.5]', className)}
    {...p}
  />
));
Textarea.displayName = 'Textarea';

export interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  /** Ties label/error to the control. Falls back to a generated id. */
  htmlFor?: string;
  className?: string;
}

/**
 * Label + control + error. Wiring `aria-describedby` is the whole point: an
 * error rendered next to an input but not associated with it does not exist for
 * a screen-reader user.
 */
export function Field({
  label,
  hint,
  required,
  error,
  children,
  htmlFor,
  className,
}: FieldProps) {
  const generated = React.useId();
  const id = htmlFor ?? generated;
  const errorId = `${id}-error`;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className="text-xs font-medium text-text-sub tracking-[.01em]"
      >
        {label}
        {required && (
          <span className="text-red ml-0.5" aria-hidden="true">
            *
          </span>
        )}
        {hint && <span className="ml-1 font-normal text-text-muted">{hint}</span>}
      </label>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement, {
            id: (children as React.ReactElement).props.id ?? id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? errorId : undefined,
            'aria-required': required || undefined,
          })
        : children}

      {error && (
        <p id={errorId} role="alert" className="text-2xs text-red">
          {error}
        </p>
      )}
    </div>
  );
}

export function InputWithIcon({
  icon,
  className,
  ...p
}: { icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span
        className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted w-3.5 h-3.5 pointer-events-none [&_svg]:w-3.5 [&_svg]:h-3.5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <input className={cn(base, 'h-ctl-md pl-7 pr-2.5', className)} {...p} />
    </div>
  );
}

export function SearchInput({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 min-w-[200px] h-ctl-md px-2.5',
        'bg-bg-card border border-border rounded-md',
        'transition-colors duration-[var(--dur)]',
        'hover:border-border-strong focus-within:border-accent',
        className,
      )}
    >
      <input
        type="search"
        className="flex-1 min-w-0 border-0 bg-transparent text-sm outline-none placeholder:text-text-muted"
        {...p}
      />
    </div>
  );
}
