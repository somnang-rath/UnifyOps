import { AlertTriangle, Minus, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Priority } from '@/lib/priorities';

/**
 * §12 PriorityIcon.
 *
 * The colour mapping is §12's, verbatim: urgent · high · medium · low · none →
 * danger · warning · sky · ink-400 · ink-300. It resolves through the
 * `--priority-*` token family rather than a ramp utility at this call site, so
 * the value flips with the theme like every other colour decision.
 *
 * **Shape carries the meaning as well as colour.** Urgent is a triangle and the
 * rest are ascending bars, so the scale is readable without colour vision — a
 * five-step ramp distinguished only by hue is the most common accessibility
 * failure in a tracker.
 *
 * `none` is deliberately drawn rather than omitted: an empty slot in a list row
 * reads as "loading", and an item with no priority set is a real state a
 * manager filters for.
 */

const ICONS: Record<Priority, typeof Minus> = {
  urgent: AlertTriangle,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
  none: Minus,
};

const COLORS: Record<Priority, string> = {
  urgent: 'text-priority-urgent',
  high: 'text-priority-high',
  medium: 'text-priority-medium',
  low: 'text-priority-low',
  none: 'text-priority-none',
};

export function PriorityIcon({
  priority,
  label,
  className,
}: {
  priority: Priority;
  /** The translated name. §12: an icon always carries a label or an accessible name. */
  label: string;
  className?: string;
}) {
  const Icon = ICONS[priority];

  return (
    <Icon
      // 16px inline, 1.5px stroke (§12).
      size={16}
      strokeWidth={1.5}
      role="img"
      aria-label={label}
      className={cn('shrink-0', COLORS[priority], className)}
    />
  );
}
