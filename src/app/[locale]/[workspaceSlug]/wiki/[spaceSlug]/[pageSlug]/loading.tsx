import { Skeleton } from '@/components/ui/feedback';

/** §20.3.2's `[L]`: the tree **and** the body block, so nothing shifts on arrival. */
export default function PageLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_14rem]">
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-3 w-40" />
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
