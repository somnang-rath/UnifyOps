import { PageSkeleton } from '@/components/ui/skeletons';

/**
 * Its own boundary, for the reason slice 16 gave every level one: without it the
 * nearest ancestor is the workspace's, which draws My Work — a set of due
 * buckets where a list of spaces is arriving, and a placeholder shaped like the
 * wrong screen *is* the layout shift §11 asks to prevent.
 */
export default function WikiLoading() {
  return <PageSkeleton rows={3} />;
}
