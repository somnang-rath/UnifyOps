import { PageSkeleton } from '@/components/ui/skeletons';

/**
 * Its own boundary, for the reason slice 16 gave every other level one: without
 * it the nearest ancestor is the workspace's, which draws My Work — a set of due
 * buckets where a composer and a list of one-line rows are arriving. A
 * placeholder shaped like the wrong screen *is* the layout shift §11 asks to
 * prevent.
 */
export default function NotesLoading() {
  return <PageSkeleton rows={6} />;
}
