import { cn } from '@/lib/cn';
import type { LabelColor } from '@/lib/label-colors';

/**
 * §12 LabelChip.
 *
 * Built the way `StatePill` is, for the same reason: the dot carries the colour
 * and the text carries the name. At 11px several of these fail AA against the
 * surface — Sky on Ivory is ~2.4:1 — and a shape that is only decoration may be
 * any colour, while a word somebody has to read may not.
 *
 * The colour arrives as one of eight token names, never as a hex. This is the
 * only place a stored value becomes a class, which is what lets a label
 * coloured in 2026 still resolve correctly in dark mode.
 */

const DOT: Record<LabelColor, string> = {
  ink: 'bg-label-ink',
  sky: 'bg-label-sky',
  navy: 'bg-label-navy',
  lilac: 'bg-label-lilac',
  chartreuse: 'bg-label-chartreuse',
  warning: 'bg-label-warning',
  success: 'bg-label-success',
  danger: 'bg-label-danger',
};

export function LabelChip({
  name,
  color,
  className,
}: {
  name: string;
  color: LabelColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-32 items-center gap-1 rounded-xs border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-text-muted',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[color])} />
      {/* Clamped by CSS, not by slicing: a Khmer label has no spaces to break
          on and cutting it in data would split a grapheme cluster (§13). */}
      <span className="truncate">{name}</span>
    </span>
  );
}
