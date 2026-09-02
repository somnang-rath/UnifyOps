/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not `clsx` + `tailwind-merge`. Merge exists to let a later class
 * override an earlier one for the same property, which is a convenience that
 * quietly makes every component's styling overridable from the outside — and
 * §12's whole position is that components use semantic tokens rather than
 * accepting arbitrary colour from a caller. Where a variant is needed, it is a
 * prop with a fixed set of values, not a class someone passes in.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
