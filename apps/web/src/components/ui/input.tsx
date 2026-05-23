'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

const base =
  'w-full rounded-sm border-[1.5px] border-border bg-bg-input text-text outline-none ' +
  'placeholder:text-text-muted ' +
  'transition-[border-color,box-shadow] duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)] ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_rgba(99,102,241,.15)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(base, 'px-3 py-[9px] text-[13px]', className)}
    {...p}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      base,
      'px-3 py-[9px] text-[13px] resize-y min-h-20 leading-[1.5]',
      className,
    )}
    {...p}
  />
));
Textarea.displayName = 'Textarea';

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-text-sub tracking-[.01em]">
        {label}
        {required && <span className="text-red ml-1">*</span>}
        {hint && (
          <span className="ml-1 font-normal text-text-muted">{hint}</span>
        )}
      </label>
      {children}
      {error && (
        <p className="min-h-5 px-2.5 py-1.5 rounded-sm text-[12px] text-red bg-[rgba(239,68,68,.08)]">
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
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4 pointer-events-none">
        {icon}
      </span>
      <input
        className={cn(base, 'pl-[38px] pr-3 py-[9px] text-[13px]', className)}
        {...p}
      />
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
        'flex items-center gap-2 min-w-[220px] px-3',
        'bg-bg-card border-[1.5px] border-border rounded-sm',
        'transition-[border-color,box-shadow] duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)]',
        'focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]',
        className,
      )}
    >
      <input
        type="search"
        className="flex-1 border-0 bg-transparent py-2 text-[13px] outline-none placeholder:text-text-muted"
        {...p}
      />
    </div>
  );
}
