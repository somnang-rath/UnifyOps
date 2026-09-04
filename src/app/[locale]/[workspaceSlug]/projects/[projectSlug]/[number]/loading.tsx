import { DetailSkeleton } from '@/components/ui/skeletons';

/**
 * The item page's own boundary.
 *
 * Without it the nearest ancestor is the project's, which draws a **board** —
 * six columns of cards where a title and a comment thread are arriving. A
 * skeleton that is shaped like a different screen is worse than none.
 */
export default function WorkItemLoading() {
  return <DetailSkeleton />;
}
