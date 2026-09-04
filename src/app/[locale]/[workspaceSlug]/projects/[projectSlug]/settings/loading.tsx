import { PageSkeleton } from '@/components/ui/skeletons';

/** As for the item page: the project's board skeleton is the wrong shape here. */
export default function ProjectSettingsLoading() {
  return <PageSkeleton rows={6} />;
}
