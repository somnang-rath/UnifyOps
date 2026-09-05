'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Hash, Sparkles } from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { DocumentBody } from '@/components/ui/document-body';
import { noteTitle, notePreview } from '@/lib/notes';
import type { NoteView } from '@/server/services/notes';
import type { ProjectChoice, SpaceChoice } from './note-promote';
import { NoteComposer } from './note-composer';
import { NoteDelete } from './note-delete';
import { NotePromote } from './note-promote';

/**
 * §20.11's notes screen, below the composer.
 *
 * A client component where the comment thread beside it is a server one, and
 * the reason is the expand-to-edit: a note opens *in place* rather than on its
 * own route, because §20.3.1's whole promise is that a note costs nothing to
 * write and nothing to come back to. A route per note would make reading three
 * of them three navigations.
 *
 * **The title is derived, never stored** (§20.4), and it is derived here by the
 * same `noteTitle` the server uses — one implementation, so the row a person
 * sees while typing and the row they see after saving are the same row.
 *
 * §11's five states: `[L]` the route's `loading.tsx` draws these rows as
 * skeletons · `[E]` §20.3.1's empty state, which says notes are private and
 * shows the `⌘K` hint rather than a tour · `[S]` the action revalidates and the
 * list re-renders · `[X]` a row's own failure reports in that row, which is
 * §11's rule · `[!]` a note that has been promoted says what it became, and a
 * note pinned to an item names it.
 */
export function NoteList({
  notes,
  total,
  workspaceSlug,
  locale,
  projects,
  spaces,
}: {
  notes: readonly NoteView[];
  total: number;
  workspaceSlug: string;
  locale: string;
  projects: readonly ProjectChoice[];
  /** §20.3.4's second destination, added in slice 18. */
  spaces: readonly SpaceChoice[];
}) {
  const t = useTranslations();

  if (notes.length === 0) {
    // §20.3.1's `[E]`: "one line saying that notes are private and never leave
    // this screen, plus the same ⌘K hint". Not a tour, and not a shrug.
    return <EmptyState title={t('notes.empty')} />;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            workspaceSlug={workspaceSlug}
            locale={locale}
            projects={projects}
            spaces={spaces}
          />
        ))}
      </ul>

      {/*
        The list is capped rather than paged, and says so when it is capped
        rather than pretending the cap is the total — the same honesty slice 13
        applied to My Work's buckets and slice 14 to the search sections.
      */}
      {total > notes.length ? (
        <p className="text-xs text-text-subtle">
          {t('notes.showingFirst', { shown: notes.length, total })}
        </p>
      ) : null}
    </div>
  );
}

function NoteRow({
  note,
  workspaceSlug,
  locale,
  projects,
  spaces,
}: {
  note: NoteView;
  workspaceSlug: string;
  locale: string;
  projects: readonly ProjectChoice[];
  /** §20.3.4's second destination, added in slice 18. */
  spaces: readonly SpaceChoice[];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  /**
   * Reading and editing are two states of one row, not two screens.
   *
   * A note opens **read** first, because most of the time somebody is coming
   * back to look at what they wrote rather than to change it — and because a
   * body that opens as a textarea never shows its own Markdown, which would make
   * §20.7's renderer something nobody in this slice ever sees. Editing is one
   * click from there, and the composer keeps the text through a failed save
   * either way (§20.3.1's `[X]`).
   */
  const [editing, setEditing] = useState(false);

  const title = noteTitle(note);
  const preview = notePreview(note);

  return (
    // The anchor the palette and the search results link to. A note has no
    // route of its own (§20.11 lists one notes screen), so `#note-<id>` is how
    // a result reaches the row it names — the browser scrolls to it, and the
    // row opens on the click that follows.
    <li id={`note-${note.id}`} className="px-3 py-2">
      <div className="flex items-start gap-2">
        {/*
          A real button with an accessible name, not a chevron with a click
          handler on it. §11's baseline is the whole loop without a mouse, and
          `aria-expanded` is what tells a screen reader this row has more in it.
        */}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="mt-px shrink-0"
        >
          {open ? (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          <span className="sr-only">
            {open ? t('notes.collapse', { title }) : t('notes.expand', { title })}
          </span>
        </Button>

        <div className="min-w-0 flex-1 space-y-1">
          {/* `truncate` is a CSS ellipsis on one line of already-derived text —
              the grapheme truncation §13 requires happened in `noteTitle`, which
              is where the string is actually shortened. */}
          <p className="truncate text-sm font-medium text-text">
            {title || t('notes.untitled')}
          </p>
          {preview && !open ? (
            <p className="truncate text-xs text-text-subtle">{preview}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
            <time dateTime={note.updatedAt}>
              {format.dateTime(new Date(note.updatedAt), 'short')}
            </time>

            {note.pin ? (
              <Link
                href={`/${workspaceSlug}/projects/${note.pin.projectSlug}/${note.pin.number}`}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Hash size={12} strokeWidth={1.5} aria-hidden="true" />
                {note.pin.identifier}
              </Link>
            ) : null}

            {/* §20.3.4's "quiet line recording what it became". Quiet is the
                word: a badge, on the private side, and not an event anywhere. */}
            {note.promoted ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" />
                <Badge>{t('notes.became', { identifier: note.promoted.identifier })}</Badge>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 ps-8">
          {editing ? (
            <NoteComposer
              workspaceSlug={workspaceSlug}
              locale={locale}
              noteId={note.id}
              initialBody={note.body}
              autoFocus
              onSaved={() => setEditing(false)}
            />
          ) : (
            <DocumentBody
              body={note.body}
              context={{ workspaceSlug }}
              className="rounded-md border border-border bg-surface-sunken px-3 py-2"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing((was) => !was)}>
              {editing ? t('action.cancel') : t('notes.edit')}
            </Button>
            <NotePromote
              workspaceSlug={workspaceSlug}
              locale={locale}
              noteId={note.id}
              projects={projects}
              spaces={spaces}
              alreadyPromoted={note.promoted !== null}
            />
            <NoteDelete workspaceSlug={workspaceSlug} locale={locale} noteId={note.id} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
