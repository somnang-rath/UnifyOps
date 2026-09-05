'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import {
  promoteNoteAction,
  promoteNoteToPageAction,
} from '@/app/[locale]/[workspaceSlug]/notes/actions';

/**
 * §20.3.4: a note becomes a work item.
 *
 * **A copy, never a move**, and the copy is why this control is safe to put on
 * the private screen at all: §20.1 calls a move "the one operation that silently
 * changes who can read something, and it would do it from the one screen whose
 * whole promise is that nobody else can". The note stays exactly where it was
 * and gains a quiet line saying what came out of it.
 *
 * **Only projects this person may create work in are offered**, and a project
 * they cannot is not listed at all rather than listed and disabled — §20.3.4's
 * `[!]` for the space case, which is §7.11's rule about the disabled select
 * ("a disabled select invites somebody to go looking for the permission that
 * would enable it"). The service checks the same thing again, because a list
 * rendered a minute ago is a client's opinion.
 *
 * §20.3.4 says promotion "opens §7.2's create with the body carried across, so
 * it lands in a project, in a state, with an assignee". The project is chosen
 * here; the state is the project's first, which is what `createWorkItem` already
 * means by an absent state; the assignee is nobody, and the person lands on the
 * item where §7.2's controls already are. **§4's full create form is still the
 * slice-5 gap** recorded in CLAUDE.md, and when it exists this control is what
 * should open it.
 */

export type ProjectChoice = {
  id: string;
  name: string;
};

/** A space this person may write in (§20.5). Filtered by the page, never disabled. */
export type SpaceChoice = {
  id: string;
  name: string;
};

export function NotePromote({
  workspaceSlug,
  locale,
  noteId,
  projects,
  spaces,
  alreadyPromoted,
}: {
  workspaceSlug: string;
  locale: string;
  noteId: string;
  projects: readonly ProjectChoice[];
  /**
   * §20.3.4's second destination, added in slice 18: "**to a page** (choose a
   * space they may write in; the note's body becomes the first revision)."
   *
   * Offered *beside* the work-item form rather than as a mode of it, because the
   * two are different destinations with different pickers and a person choosing
   * between them is choosing a noun. §20.3.4's `[!]` is honoured the same way as
   * the projects list: "the space is not offered, and the picker says why rather
   * than showing a disabled row nobody can explain".
   */
  spaces: readonly SpaceChoice[];
  /** Promotion is a copy, so this is a caution and never a bar. */
  alreadyPromoted: boolean;
}) {
  // Two forms rather than one with a mode: §20.3.4 offers a note *two*
  // destinations, and a person choosing between them is choosing a noun. Each
  // owns its own action state, so a failure on one does not blank the other.
  return (
    <div className="space-y-2">
      <PromoteToItem
        workspaceSlug={workspaceSlug}
        locale={locale}
        noteId={noteId}
        projects={projects}
        alreadyPromoted={alreadyPromoted}
      />
      <PromoteToPage
        workspaceSlug={workspaceSlug}
        locale={locale}
        noteId={noteId}
        spaces={spaces}
      />
    </div>
  );
}

function PromoteToItem({
  workspaceSlug,
  locale,
  noteId,
  projects,
  alreadyPromoted,
}: {
  workspaceSlug: string;
  locale: string;
  noteId: string;
  projects: readonly ProjectChoice[];
  alreadyPromoted: boolean;
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<RowActionState, FormData>(
    promoteNoteAction,
    ROW_IDLE,
  );

  // Nothing to promote into. Said rather than shown as an empty select, because
  // a select with no options is a control that looks broken.
  if (projects.length === 0) {
    return <p className="text-xs text-text-subtle">{t('notes.promote.noProjects')}</p>;
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="noteId" value={noteId} />

      <SelectField
        name="projectId"
        label={t('notes.promote.project')}
        className="min-w-48"
        defaultValue={projects[0]?.id}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </SelectField>

      <Button type="submit" loading={pending}>
        {alreadyPromoted ? t('notes.promote.again') : t('notes.promote.submit')}
      </Button>

      {state.error && (
        <span role="alert" className="text-xs text-danger">
          {t(state.error)}
        </span>
      )}
      {state.done && !state.error && (
        <span role="status" className="text-xs text-text-subtle">
          {t('notes.promote.done')}
        </span>
      )}
    </form>
  );
}

/**
 * §20.3.4's other destination: the note becomes a wiki page.
 *
 * The same rules as above and one difference worth naming: the picker offers
 * **spaces this person may write in**, which is §20.5's question rather than
 * §10's — `listSpaces` answers it once, in the one module that implements it,
 * and the page passes the answer down.
 */
function PromoteToPage({
  workspaceSlug,
  locale,
  noteId,
  spaces,
}: {
  workspaceSlug: string;
  locale: string;
  noteId: string;
  spaces: readonly SpaceChoice[];
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<RowActionState, FormData>(
    promoteNoteToPageAction,
    ROW_IDLE,
  );

  if (spaces.length === 0) {
    return <p className="text-xs text-text-subtle">{t('wiki.promote.noSpaces')}</p>;
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="noteId" value={noteId} />

      <SelectField
        name="spaceId"
        label={t('wiki.promote.space')}
        className="min-w-48"
        defaultValue={spaces[0]?.id}
      >
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </SelectField>

      <Button type="submit" loading={pending}>
        {t('wiki.promote.submit')}
      </Button>

      {state.error && (
        <span role="alert" className="text-xs text-danger">
          {t(state.error)}
        </span>
      )}
      {state.done && !state.error && (
        <span role="status" className="text-xs text-text-subtle">
          {t('wiki.promote.done')}
        </span>
      )}
    </form>
  );
}
