import { ViewSkeleton } from '@/components/views/view-skeleton';

/**
 * §7.1's `[L]`: "skeleton board with state columns already drawn."
 *
 * The shape is decided in `ViewSkeleton`, on the client, from the URL — see the
 * note there for why a `loading.tsx` cannot decide it here.
 */
export default function ProjectLoading() {
  return <ViewSkeleton />;
}
