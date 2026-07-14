'use client';
import * as React from 'react';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

/** Labeled input with an optional leading icon. Forwards all native props. */
export const AuthField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    icon?: React.ComponentType<{ size?: number | string; className?: string }>;
    hint?: string;
  }
>(function AuthField({ label, icon: Icon, hint, className, ...props }, ref) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
        )}
        <input
          ref={ref}
          className={
            'w-full rounded-lg border border-line bg-surface py-2.5 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand ' +
            (Icon ? 'pl-9 pr-3 ' : 'px-3 ') +
            (className ?? '')
          }
          {...props}
        />
      </div>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
});

/** Password field with a show/hide toggle. */
export const PasswordField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    icon?: React.ComponentType<{ size?: number | string; className?: string }>;
    hint?: string;
  }
>(function PasswordField({ label, icon: Icon, hint, className, ...props }, ref) {
  const [show, setShow] = React.useState(false);
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
        )}
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={
            'w-full rounded-lg border border-line bg-surface py-2.5 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand ' +
            (Icon ? 'pl-9 pr-10 ' : 'pl-3 pr-10 ') +
            (className ?? '')
          }
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle transition-colors hover:text-fg"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
});

/** Full-width brand-colored submit button with a loading state. */
export function SubmitButton({
  busy,
  children,
  busyLabel,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || props.disabled}
      {...props}
      className={
        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-70 ' +
        (props.className ?? '')
      }
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {busy ? (busyLabel ?? 'Please wait…') : children}
    </button>
  );
}

/** Inline error banner. */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
