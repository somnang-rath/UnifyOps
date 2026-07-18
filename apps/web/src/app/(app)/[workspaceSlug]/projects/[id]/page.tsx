import { redirect } from 'next/navigation';

// The project index redirects to its Overview — the default Plane-style tab.
export default function ProjectIndexPage({
  params,
}: {
  params: { workspaceSlug: string; id: string };
}) {
  redirect(`/${params.workspaceSlug}/projects/${params.id}/overview`);
}
