import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * §12 Input, and the label/help/error shell every form control in the product
 * shares.
 *
 * Two rules from §12 are structural rather than cosmetic:
 *
 * - **Placeholders are never labels.** The label sits above the control at 12px
 *   and is always present. A placeholder disappears the moment someone types,
 *   which is exactly when they need to check what the field was.
 * - **The error replaces the help text** rather than appearing below it.
 *   Otherwise the field grows and the form reflows at the moment the user made
 *   a mistake, moving the thing they were about to click.
 */

const CONTROL_CLASSES = cn(
  'w-full rounded-xs border border-border bg-surface px-2.5 text-sm text-text',
  'placeholder:text-text-subtle',
  'transition-colors duration-120 ease-[var(--ease-out-soft)]',
  'hover:border-border-strong',
  'aria-[invalid=true]:border-danger',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-subtle',
);

type FieldShellProps = {
  id: string;
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  describedBy: string;
};

function FieldShell({ id, label, help, error, required, children, describedBy }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-text-muted">
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger">
            *
          </span>
        )}
      </label>

      {children}

      {(error ?? help) && (
        <p
          id={describedBy}
          className={cn('text-xs', error ? 'text-danger' : 'text-text-subtle')}
          // Errors arrive after a submit the user is watching for; help text is
          // static and announcing it would be noise.
          role={error ? 'alert' : undefined}
        >
          {error ?? help}
        </p>
      )}
    </div>
  );
}

export type InputFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  help?: string;
  error?: string;
};

export function InputField({ label, help, error, className, ...props }: InputFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <FieldShell
      id={id}
      label={label}
      help={help}
      error={error}
      required={props.required}
      describedBy={messageId}
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ?? help ? messageId : undefined}
        className={cn(CONTROL_CLASSES, 'h-8', className)}
        {...props}
      />
    </FieldShell>
  );
}

export type TextareaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  help?: string;
  error?: string;
};

export function TextareaField({ label, help, error, className, ...props }: TextareaFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <FieldShell
      id={id}
      label={label}
      help={help}
      error={error}
      required={props.required}
      describedBy={messageId}
    >
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ?? help ? messageId : undefined}
        className={cn(CONTROL_CLASSES, 'min-h-24 py-2 leading-relaxed', className)}
        {...props}
      />
    </FieldShell>
  );
}

export type SelectFieldProps = Omit<
  InputHTMLAttributes<HTMLSelectElement>,
  'id' | 'size' | 'type'
> & {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
};

/**
 * A native `<select>`.
 *
 * §12 asks for a Radix Select with type-ahead **above seven options**; the two
 * pickers in this slice have four and a handful. Below that threshold the
 * platform control is better than anything we would build: it is already
 * keyboard-operable, already announced correctly, and on a phone it opens the
 * OS picker rather than a list that fights the viewport. The Radix version
 * arrives with the surfaces that actually need it.
 */
export function SelectField({ label, help, error, className, children, ...props }: SelectFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <FieldShell
      id={id}
      label={label}
      help={help}
      error={error}
      required={props.required}
      describedBy={messageId}
    >
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ?? help ? messageId : undefined}
        className={cn(CONTROL_CLASSES, 'h-8', className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}
