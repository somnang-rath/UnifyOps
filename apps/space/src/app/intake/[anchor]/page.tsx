import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getIntakeForm } from '@/lib/public-api';
import { IntakeFormView } from '@/components/intake-form';

// The form's open/closed state is live — a closed form must 404 on the next
// request, not when a cache decides to expire.
export const dynamic = 'force-dynamic';

type Params = { params: { anchor: string } };

/**
 * An intake form is a write surface handed to specific people, never something
 * to be found in a search index — so this page is always noindex, regardless of
 * `SPACE_INDEXING`. That is the opposite default from published content
 * (`[anchor]/page.tsx`), where the owner chooses per page.
 */
const ROBOTS: Metadata['robots'] = {
  index: false,
  follow: false,
  nocache: true,
  noarchive: true,
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const form = await getIntakeForm(params.anchor).catch(() => null);
  return {
    title: form ? `${form.title} · Prism Space` : 'Not found · Prism Space',
    robots: ROBOTS,
  };
}

export default async function IntakePage({ params }: Params) {
  const form = await getIntakeForm(params.anchor);
  if (!form) notFound();

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{form.title}</h1>
          {form.description && (
            <p className="mt-2 text-[14px] leading-relaxed text-gray-500 whitespace-pre-wrap">
              {form.description}
            </p>
          )}
        </header>
        <IntakeFormView form={form} />
      </div>
    </main>
  );
}
