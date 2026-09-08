import { getFormatter, getTranslations } from 'next-intl/server';
import { DocumentBody } from '@/components/ui/document-body';
import { PagePrint } from '@/components/wiki/page-print';
import { Link } from '@/i18n/navigation';
import { documentText } from '@/lib/documents';
import { hasKhmer } from '@/lib/search';
import type { PageDetail, PageRef } from '@/server/queries/wiki';

/**
 * A page, read (§20.11).
 *
 * A **server** component, which is what slice 17's `DocumentBody` was written to
 * allow: "slice 18's page reader will render it on the server, like the comment
 * thread and the activity feed — the parse and the locale resolved where they
 * already are." The notes list imports the same renderer from a client component
 * because a note's row toggles between reading and editing; a page has a
 * separate editor route, so nothing here needs a bundle.
 *
 * `[E]` §20.11: "an empty page reads as empty, not as broken." A page with no
 * body renders its title, its metadata and a quiet line — not an `EmptyState`
 * card, which would read as a failure to load rather than as a page somebody has
 * not written yet.
 */
export async function PageReader({
  page,
  workspaceSlug,
  spaceSlug,
  mentioned,
  pages,
  canWrite,
}: {
  page: PageDetail;
  workspaceSlug: string;
  spaceSlug: string;
  mentioned: Record<string, string>;
  pages: PageRef[];
  canWrite: boolean;
}) {
  const [t, format] = await Promise.all([getTranslations('wiki'), getFormatter()]);

  return (
    <article className="space-y-4">
      <header className="space-y-2">
        <h1
          /*
           * §20.10, and the reason a page is where §13's oldest gap became
           * unignorable: a page is the longest continuous run of user text in the
           * product, and its title is the largest type on the screen. Khmer
           * stacks diacritics vertically and clips at Latin line-heights.
           */
          lang={hasKhmer(page.title) ? 'km' : undefined}
          className="flex items-baseline gap-2 font-display text-2xl font-semibold tracking-tight text-text"
        >
          {page.icon && (
            /*
             * Decorative (§21.2, slice 20). The title carries the meaning, and
             * an emoji announced before every page heading is noise a screen
             * reader cannot skip — the same call `page-backlinks.tsx` makes for
             * the icon in its list.
             */
            <span aria-hidden="true" className="shrink-0">
              {page.icon}
            </span>
          )}
          <span className="min-w-0">{page.title}</span>
        </h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted">
          {/*
            The revision number and the date, which §20.3.2's `[S]` asks a save to
            confirm. Latin digits are pinned for both locales in
            `src/i18n/request.ts`, so `formats` does the §13 work here rather than
            each call site remembering to.
          */}
          <span>{t('reader.revision', { number: page.revisionNo })}</span>
          <span>{format.dateTime(page.updatedAt, 'short')}</span>

          <Link
            href={`/${workspaceSlug}/wiki/${spaceSlug}/${page.slug}/history`}
            className="text-accent hover:underline"
          >
            {t('reader.history')}
          </Link>

          {canWrite && (
            <Link
              href={`/${workspaceSlug}/wiki/${spaceSlug}/${page.slug}/edit`}
              className="text-accent hover:underline"
            >
              {t('reader.edit')}
            </Link>
          )}

          {/*
            §21.8's per-page export, beside History and Edit rather than in the
            right rail: it is a thing to do *with this document*, which is what
            the line under the title is for, and the rail is for properties of
            it. Offered to every reader, because §21.8's whole argument is that
            leaving with your own documents must be easy.
          */}
          <PagePrint />

          {/*
            §21.7, and the reason it is stated on the reader at all: a template
            is an ordinary page that is missing from the sidebar, so a reader who
            arrived by link and cannot find it in the tree would otherwise think
            the tree was broken.
          */}
          {page.isTemplate && (
            <span className="rounded-xs bg-surface-sunken px-1.5 py-0.5 text-text-muted">
              {t('template.badge')}
            </span>
          )}
        </div>
      </header>

      {page.body.trim().length === 0 ? (
        <p className="text-sm text-text-subtle">{t('reader.emptyBody')}</p>
      ) : (
        <DocumentBody
          body={page.body}
          context={{
            workspaceSlug,
            mentioned,
            pages: pageContext(pages, workspaceSlug),
            /*
              What a callout with no title of its own is called (§21.5). From the
              catalogue rather than from the parser, because it is the one word
              in a rendered body the product supplies — and a body must never
              carry an English word into a Khmer page (§13).
            */
            calloutLabels: {
              info: t('callout.info'),
              success: t('callout.success'),
              warning: t('callout.warning'),
              danger: t('callout.danger'),
            },
          }}
          className="max-w-prose"
        />
      )}
    </article>
  );
}

/**
 * The `#[uuid]` resolver `DocumentBody` takes.
 *
 * A map from id to what the renderer needs — a title and a href, or the fact
 * that the page is deleted. §20.3.6: "deleting a page other pages reference →
 * allowed, and the references render as 'a deleted page' rather than breaking,
 * the same way an activity line naming a hard-deleted workflow state does."
 *
 * Built here rather than inside the renderer because the renderer is in
 * `components/ui` and knows nothing about routes or workspaces — the same line
 * `DocumentContext` already draws for `workspaceSlug`.
 */
export function pageContext(
  pages: PageRef[],
  workspaceSlug: string,
): Record<string, { title: string; href: string | null; excerpt?: string }> {
  return Object.fromEntries(
    pages.map((page) => [
      page.id,
      {
        title: page.title,
        // A deleted page is named and not linked: the reference should say what
        // it referred to, and the link would 404 into slice 16's "four causes"
        // page, which is a worse answer than a plain word.
        href: page.deleted ? null : `/${workspaceSlug}/wiki/${page.spaceSlug}/${page.slug}`,
        excerpt: previewOf(page.excerpt),
      },
    ]),
  );
}

/**
 * The first line of a referenced page, for §21.4's hover preview.
 *
 * **Read through the parser, never sliced off the raw body**, which is
 * `noteTitle`'s rule from slice 17 and for the same reason: a body opening with
 * `## Rollback` should preview as *Rollback*, and a body opening with a mention
 * token should not preview as a uuid. `documentText` already walks the tree and
 * drops both.
 *
 * Truncated by **grapheme** (§13) — never `.slice()` on text a person will read,
 * because one Khmer syllable is routinely three or four code points and cutting
 * between them leaves a broken cluster on screen.
 */
const PREVIEW_GRAPHEMES = 120;

function previewOf(body: string): string | undefined {
  const [line] = documentText(body).split('\n');
  if (!line) return undefined;

  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line),
  ];
  return graphemes.length <= PREVIEW_GRAPHEMES
    ? line
    : `${graphemes.slice(0, PREVIEW_GRAPHEMES).map((part) => part.segment).join('')}…`;
}
