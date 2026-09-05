import { PageSkeleton } from '@/components/ui/skeletons';

/** §20.11: "Skeleton rows" — a list of revisions, not a page body. */
export default function HistoryLoading() {
  return <PageSkeleton rows={8} />;
}
