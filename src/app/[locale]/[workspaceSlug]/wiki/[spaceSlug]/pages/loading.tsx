import { Skeleton } from '@/components/ui/feedback';

/**
 * §21.3's `[L]`: "the All-pages table skeletons its rows."
 *
 * The shape of the arriving table rather than a generic block — §11 asks for
 * "skeletons matching the final layout, never layout shift on arrival", and a
 * placeholder shaped like the wrong thing *is* the shift it was added to
 * prevent. Heading, filter row, then rows at the table's own height.
 *
 * Its own boundary rather than the space's, for the reason slice 16 gave the
 * item page one: without it the nearest ancestor is the space home's, which
 * draws a sidebar and a body block where a six-column table is coming.
 */
export default function AllPagesLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-24" />
        ))}
      </div>

      <div className="space-y-px rounded-md border border-border p-3">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
