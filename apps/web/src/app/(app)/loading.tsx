import { Skeleton } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <div className="px-6 py-5 max-w-[1080px] mx-auto animate-fade-in">
      <Skeleton className="h-4 w-32 mb-6" />
      <Skeleton className="h-8 w-64 mb-3" />
      <Skeleton className="h-4 w-96 mb-8" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
