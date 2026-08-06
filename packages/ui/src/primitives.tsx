'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

/* ────────────────────────────── Badge ────────────────────────────── */

const badge = cva(
  'inline-flex items-center gap-1 rounded-sm font-medium whitespace-nowrap ' +
    '[&_svg]:w-3 [&_svg]:h-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-bg-subtle text-text-sub',
        accent: 'bg-accent-50 text-accent-700',
        success: 'bg-[rgba(16,185,129,.12)] text-green',
        warning: 'bg-[rgba(245,158,11,.14)] text-amber',
        danger: 'bg-[rgba(239,68,68,.12)] text-red',
        outline: 'border border-border text-text-sub',
      },
      size: {
        xs: 'h-4 px-1 text-micro',
        sm: 'h-5 px-1.5 text-2xs',
        md: 'h-[22px] px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {}

export function Badge({ className, variant, size, ...p }: BadgeProps) {
  return <span className={cn(badge({ variant, size }), className)} {...p} />;
}

/* ─────────────────────────── StateBadge ──────────────────────────── */

export type WorkItemState =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

const STATE_LABEL: Record<WorkItemState, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};

/**
 * A work-item state, shown as colour + shape + text. Colour alone would leave
 * "Done" and "Cancelled" identical to a red-green colour-blind reader, which is
 * roughly one in twelve men.
 */
export function StateBadge({
  state,
  label,
  className,
}: {
  state: WorkItemState;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <StateIcon state={state} />
      <span className="text-text-sub">{label ?? STATE_LABEL[state]}</span>
    </span>
  );
}

export function StateIcon({
  state,
  className,
}: {
  state: WorkItemState;
  className?: string;
}) {
  const color = `var(--state-${state})`;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block w-3 h-3 rounded-full border-2 shrink-0',
        state === 'completed' && 'border-0',
        className,
      )}
      style={{
        borderColor: color,
        // Started reads as half-filled, completed as solid — the fill level is
        // the signal; the hue only reinforces it.
        background:
          state === 'completed'
            ? color
            : state === 'started'
              ? `linear-gradient(90deg, ${color} 50%, transparent 50%)`
              : 'transparent',
        borderStyle: state === 'backlog' ? 'dashed' : 'solid',
      }}
    />
  );
}

/* ────────────────────────────── Avatar ───────────────────────────── */

/**
 * sm/md/lg keep the sizes apps/web already used, so adopting this component did
 * not silently resize every avatar on every screen. xs is for 22–26px rows.
 */
const SIZES = { xs: 16, sm: 24, md: 32, lg: 40, xl: 48 } as const;
export type AvatarSize = keyof typeof SIZES;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Deterministic colour per person, so the same user is the same colour everywhere. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  /**
   * Announce the name to assistive tech. Off by default: an avatar almost always
   * sits next to the name in text, and announcing it twice is worse than not at
   * all. Turn it on when the avatar stands alone (e.g. an assignee column).
   */
  labelled?: boolean;
}

export function Avatar({
  name,
  src,
  size = 'sm',
  className,
  labelled = false,
}: AvatarProps) {
  const px = SIZES[size];
  const [failed, setFailed] = React.useState(false);
  const a11y = labelled
    ? { role: 'img' as const, 'aria-label': name }
    : { 'aria-hidden': true };

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={labelled ? name : ''}
        width={px}
        height={px}
        // A broken avatar URL should fall back to initials, not a broken-image icon.
        onError={() => setFailed(true)}
        className={cn('inline-block rounded-full object-cover shrink-0', className)}
        style={{ width: px, height: px }}
        {...(labelled ? {} : { 'aria-hidden': true })}
      />
    );
  }

  const hue = hueFor(name);
  return (
    <span
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold shrink-0 select-none',
        className,
      )}
      style={{
        width: px,
        height: px,
        fontSize: Math.max(9, Math.round(px * 0.4)),
        background: `hsl(${hue} 62% 88%)`,
        color: `hsl(${hue} 62% 28%)`,
      }}
      {...a11y}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({
  people,
  max = 3,
  size = 'sm',
  className,
}: {
  people: { name: string; src?: string | null }[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((p, i) => (
        <Avatar
          key={`${p.name}-${i}`}
          {...p}
          size={size}
          className="ring-1 ring-bg-card -ml-1 first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span className="-ml-1 inline-flex items-center justify-center rounded-full bg-bg-subtle text-text-muted text-micro ring-1 ring-bg-card px-1 h-5 min-w-5">
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ─────────────────────── Checkbox / Radio / Switch ───────────────── */

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'w-3.5 h-3.5 rounded-xs border border-border-strong bg-bg-input',
      'accent-accent cursor-pointer',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className,
    )}
    {...p}
  />
));
Checkbox.displayName = 'Checkbox';

export const Radio = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    type="radio"
    className={cn(
      'w-3.5 h-3.5 border border-border-strong bg-bg-input accent-accent cursor-pointer',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className,
    )}
    {...p}
  />
));
Radio.displayName = 'Radio';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  /** Required unless a visible <label> is wired to this control. */
  'aria-label'?: string;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex items-center h-4 w-7 rounded-full shrink-0',
        'transition-colors duration-[var(--dur)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-accent' : 'bg-border-strong',
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          'block w-3 h-3 rounded-full bg-white shadow-xs',
          'transition-transform duration-[var(--dur)]',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/* ───────────────────────── Text + layout bits ────────────────────── */

export function Label({
  className,
  ...p
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-medium text-text-sub', className)}
      {...p}
    />
  );
}

/** Keyboard hint, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
export function Kbd({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[16px] h-4 px-1',
        'rounded-xs border border-border bg-bg-subtle',
        'font-sans text-micro text-text-muted',
        className,
      )}
      {...p}
    />
  );
}

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
    />
  );
}

export function Spinner({
  size = 14,
  className,
  label = 'Loading',
}: {
  size?: number;
  className?: string;
  /** English default, overridable by the app — see ADR 0016 §2.5. */
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block rounded-full border-2 border-current border-r-transparent animate-spin align-[-2px]',
        className,
      )}
      style={{ width: size, height: size, animationDuration: '600ms' }}
    />
  );
}

/**
 * CSS-only tooltip. Deliberately not a portal/popper: at this size a title-like
 * hint next to a toolbar button does not justify a positioning engine, and the
 * `title` fallback keeps it accessible when CSS hover is unavailable.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
  className,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1',
  }[side];

  return (
    <span className={cn('relative inline-flex group/tt', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap',
          'rounded-sm bg-text px-1.5 py-0.5 text-micro text-bg shadow-sm',
          'opacity-0 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          'transition-opacity duration-[var(--dur)]',
          pos,
        )}
      >
        {label}
      </span>
    </span>
  );
}
