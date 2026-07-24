import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicPayload } from '@/lib/public-api';
import { WikiArticle } from '@/components/wiki-article';
import { SpaceIssuesPage } from '@/components/space-issues-page';

// Always render fresh — published content is a live query, not a snapshot
// (ADR 0002 Phase 2 snapshot-back; ADR 0012 §5 for issues).
export const dynamic = 'force-dynamic';

type Params = { params: { anchor: string } };

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  // A metadata error bypasses error.tsx entirely (Next 14) — swallow it here
  // and let the page's own fetch throw, so §3.6's error boundary renders.
  const payload = await getPublicPayload(params.anchor).catch(() => null);
  if (!payload) return { title: 'Not found · Prism Space' };
  switch (payload.type) {
    case 'wiki': {
      const images = payload.coverImage ? [payload.coverImage] : undefined;
      return {
        title: `${payload.title} · Prism Space`,
        description: `Published page: ${payload.title}`,
        openGraph: {
          title: payload.title,
          type: 'article',
          images,
        },
        twitter: {
          card: images ? 'summary_large_image' : 'summary',
          title: payload.title,
          images,
        },
      };
    }
    case 'view':
      return {
        title: payload.projectName
          ? `${payload.title} · ${payload.projectName} · Prism Space`
          : `${payload.title} · Prism Space`,
        description: payload.projectName
          ? `Public board for ${payload.projectName}`
          : 'Published view',
        openGraph: { title: payload.title, type: 'website' },
      };
    case 'project':
      return {
        title: `${payload.title} · Prism Space`,
        description: truncate(
          payload.description ?? 'Published project board',
          160,
        ),
        openGraph: { title: payload.title, type: 'website' },
      };
    default:
      return { title: 'Not found · Prism Space' };
  }
}

export default async function PublicPage({ params }: Params) {
  const payload = await getPublicPayload(params.anchor);
  if (!payload) notFound();

  // Branch on the discriminated union (ADR 0012 §6). Unknown types → 404, so
  // an older space build degrades to "not found", never to a crash.
  switch (payload.type) {
    case 'wiki':
      return <WikiArticle page={payload} />;
    case 'view':
    case 'project':
      return <SpaceIssuesPage payload={payload} />;
    default:
      notFound();
  }
}
