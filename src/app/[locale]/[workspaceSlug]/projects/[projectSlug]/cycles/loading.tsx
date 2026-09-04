import { PageSkeleton } from '@/components/ui/skeletons';

/** As for the item page: the project's board skeleton is the wrong shape here. */
export default function CyclesLoading() {
  return <PageSkeleton rows={5} />;
}
