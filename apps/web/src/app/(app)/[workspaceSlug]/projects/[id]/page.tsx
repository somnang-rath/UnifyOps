import { redirect } from 'next/navigation';

// The project index redirects to its Overview — the default Plane-style tab.
// Forward the query string so pane-carried flags (e.g. `?chrome=0`) survive the
// hop instead of the pane reloading with full app chrome.
export default function ProjectIndexPage({
  params,
  searchParams,
}: {
  params: { workspaceSlug: string; id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]],
    ) as [string, string][],
  ).toString();
  redirect(
    `/${params.workspaceSlug}/projects/${params.id}/overview${qs ? `?${qs}` : ''}`,
  );
}
