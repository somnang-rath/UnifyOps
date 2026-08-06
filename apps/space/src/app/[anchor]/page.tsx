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

/**
 * Crawler directive for one published page (docs/plan/01 §3.4).
 *
 * Two switches, and the restrictive one always wins:
 *  - `SPACE_INDEXING=off` turns the whole instance noindex (it also drives
 *    `robots.ts`, which is the site-wide statement crawlers read first).
 *  - `payload.indexable` is the per-page setting an owner chose at publish
 *    time. Sharing a board with a client and inviting Google are different
 *    decisions, and until this existed only the instance-wide switch existed.
 *
 * Next emits this as `<meta name="robots">`. That is the per-page equivalent of
 * an `X-Robots-Tag` header and the only one available here — response headers
 * in `next.config.mjs` are matched by path pattern, and `[anchor]` is exactly
 * the case a pattern cannot decide.
 *
 * `nocache`/`noarchive` ride along with noindex: a page the owner does not want
 * found should not survive in a search cache either. This is never an access
 * control — a noindex page is still readable by anyone holding its link.
 */
function robotsFor(indexable: boolean): Metadata['robots'] {
  const allowed = indexable && process.env.SPACE_INDEXING !== 'off';
  return allowed
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true, noarchive: true };
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  // A metadata error bypasses error.tsx entirely (Next 14) — swallow it here
  // and let the page's own fetch throw, so §3.6's error boundary renders.
  const payload = await getPublicPayload(params.anchor).catch(() => null);
  // A page that does not resolve must never be indexed either.
  if (!payload) {
    return { title: 'Not found · Prism Space', robots: robotsFor(false) };
  }
  const robots = robotsFor(payload.indexable);
  switch (payload.type) {
    case 'wiki': {
      const images = payload.coverImage ? [payload.coverImage] : undefined;
      return {
        title: `${payload.title} · Prism Space`,
        description: `Published page: ${payload.title}`,
        robots,
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
        robots,
        openGraph: { title: payload.title, type: 'website' },
      };
    case 'project':
      return {
        title: `${payload.title} · Prism Space`,
        description: truncate(
          payload.description ?? 'Published project board',
          160,
        ),
        robots,
        openGraph: { title: payload.title, type: 'website' },
      };
    default:
      return { title: 'Not found · Prism Space', robots: robotsFor(false) };
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
