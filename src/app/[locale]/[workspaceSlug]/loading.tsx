import { PageSkeleton } from '@/components/ui/skeletons';

/**
 * §11's loading state for every workspace screen that does not draw its own.
 *
 * It sits **inside** the workspace layout, so the header, the accent, the toast
 * region and the view-as bar are already on screen and do not flash — which is
 * the reason this is a segment boundary rather than a full-page placeholder.
 */
export default function WorkspaceLoading() {
  return <PageSkeleton />;
}
