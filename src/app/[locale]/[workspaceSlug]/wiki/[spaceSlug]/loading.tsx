import { Skeleton } from '@/components/ui/feedback';

/**
 * §20.3.2's `[L]`: "the reader skeletons the sidebar tree **and** the body
 * block, because a tree that appears after the body is the layout shift §11
 * forbids."
 *
 * Two columns at the same breakpoint the screen itself uses, so the skeleton and
 * the arrival are the same shape rather than merely the same height.
 */
export default function SpaceLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
