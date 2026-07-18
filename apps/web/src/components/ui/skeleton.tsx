import { cn } from '@/lib/utils';

/**
 * Skeleton and SkeletonText now come from @prism/ui so web, admin, and space
 * shimmer the same way. The page-shaped skeletons below stay here — they mirror
 * this app's specific layouts and have no meaning in the other two.
 */
export { Skeleton, SkeletonText } from '@prism/ui';
import { Skeleton, SkeletonText } from '@prism/ui';

export function IssueDetailSkeleton() {
  return (
    <div className="max-w-[1080px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-5 mb-5">
        <div className="flex items-start gap-4">
          <Skeleton className="w-11 h-11 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_264px] gap-5">
        <div className="flex flex-col gap-4">
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="px-5 py-4">
              <SkeletonText lines={4} />
            </div>
          </div>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="px-5 py-4">
              <SkeletonText lines={2} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="p-3 flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2">
                  <Skeleton className="w-4 h-4 rounded" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-2 w-12" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="max-w-[1080px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-6 mb-5">
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="w-12 h-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="w-5 h-5 rounded" />
              <Skeleton className="h-4 w-32" />
            </div>
            <SkeletonText lines={2} />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NoteDetailSkeleton() {
  return (
    <div className="max-w-[860px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex items-start gap-3 mb-6">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-4 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonText
            key={i}
            lines={i % 3 === 0 ? 1 : 2}
            className={i % 3 === 0 ? 'mb-1' : ''}
          />
        ))}
      </div>
    </div>
  );
}
