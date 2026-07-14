import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicPage, sanitizeContent } from '@/lib/public-api';

// Always render fresh — published content can change (Phase 2 snapshot-back).
export const dynamic = 'force-dynamic';

type Params = { params: { anchor: string } };

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const page = await getPublicPage(params.anchor);
  if (!page) return { title: 'Not found · Prism Space' };
  return {
    title: `${page.title} · Prism Space`,
    description: `Published page: ${page.title}`,
    openGraph: { title: page.title, type: 'article' },
  };
}

export default async function PublicPage({ params }: Params) {
  const page = await getPublicPage(params.anchor);
  if (!page) notFound();

  const html = sanitizeContent(page.contentHTML);
  const updated = new Date(page.updatedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <main className="min-h-screen">
      <article className="mx-auto max-w-[720px] px-6 py-14">
        <header className="mb-8 border-b border-gray-100 dark:border-gray-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
          <p className="mt-2 text-[13px] text-gray-500">
            Last updated {updated}
          </p>
        </header>
        <div
          className="prose-space"
          // Sanitized in sanitizeContent() — the single security boundary for
          // public rendering (ADR 0002 §5).
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="mt-14 pt-6 border-t border-gray-100 dark:border-gray-800 text-[12px] text-gray-400">
          Published with Prism
        </footer>
      </article>
    </main>
  );
}
