import { cn } from '@/lib/cn';
import type { StateColor } from '@/lib/state-groups';

/**
 * §12's StatePill: the name of a workflow state, with the colour the company
 * chose for it.
 *
 * The colour arrives as one of six token names, never as a hex — the value has
 * to resolve differently in dark mode, and a hex written into a row in 2026
 * cannot. That is why `state_color` is an enum in the database, why
 * `--state-*` exists as a semantic alias in both themes, and why this map is
 * the only place a stored value becomes a class.
 *
 * The dot carries the colour and the text carries the name, rather than
 * colouring the text itself: at 12px, several of these fail AA against the
 * surface (§12 — Sky on Ivory is ~2.4:1). A shape that is only decoration can
 * be any colour; a label people have to read cannot.
 */

const DOT: Record<StateColor, string> = {
  ink: 'bg-state-ink',
  sky: 'bg-state-sky',
  navy: 'bg-state-navy',
  warning: 'bg-state-warning',
  success: 'bg-state-success',
  danger: 'bg-state-danger',
};

export function StatePill({
  name,
  color,
  count,
  className,
}: {
  name: string;
  color: StateColor;
  /** A micro count beside the name, when there is one worth showing. */
  count?: number;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-text', className)}>
      {/* Decoration only — the name beside it is the accessible content, so a
          screen reader is not made to say "orange circle" before every column. */}
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[color])} />
      <span className="truncate">{name}</span>
      {count !== undefined && (
        <span className="text-2xs font-medium tabular-nums text-text-subtle">{count}</span>
      )}
    </span>
  );
}
