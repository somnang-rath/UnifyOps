'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { RowActionState, WikiPageFormState } from '@/lib/form-state';
import {
  createPage,
  deletePage,
  linkPageByIdentifier,
  movePage,
  renameSpace,
  reorderPages,
  restorePage,
  restoreRevision,
  saveWikiPage,
  unlinkPageFromItem,
  type WikiFailure,
} from '@/server/services/wiki';

/**
 * The wiki's actions (§20.3.2, §20.3.3, §20.3.6 — slice 18).
 *
 * **Every failure crosses the wire as a message key, never a sentence** — §13's
 * rule, and the one place Khmer would silently degrade if it were broken. The
 * service returns identifiers; this file maps them; the component translates.
 *
 * **No permission check in this file.** Every action names a page or a space by
 * id and every service call resolves that space and asks `space-access.ts`,
 * which asks §10. A check here would be a second implementation of §20.5's rule
 * for the two to drift apart — the trap `listProjects` avoids by treating its
 * SQL predicate as an optimisation of the policy module rather than a second
 * opinion.
 */

const KEYS: Record<WikiFailure, string> = {
  title_required: 'wiki.errors.titleRequired',
  title_too_long: 'wiki.errors.titleTooLong',
  body_too_long: 'wiki.errors.bodyTooLong',
  too_deep: 'wiki.errors.tooDeep',
  not_found: 'wiki.errors.notFound',
  archived: 'wiki.errors.archived',
  forbidden: 'wiki.errors.forbidden',
  slug_taken: 'wiki.errors.slugTaken',
  into_descendant: 'wiki.errors.intoDescendant',
  unknown_item: 'wiki.errors.unknownItem',
  stale: 'wiki.errors.stale',
  mention_not_visible: 'wiki.errors.mentionNotVisible',
};

type Context = { workspaceSlug: string; locale: 'en' | 'km' };

function contextFrom(formData: FormData): Context {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    locale: formData.get('locale') === 'km' ? 'km' : 'en',
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

/**
 * Revalidate the whole wiki subtree rather than one page.
 *
 * A save changes the reader *and* the sidebar tree the reader renders beside it
 * — a rename moves the page in the list — and revalidating only the page URL
 * would leave a sidebar naming the old title on every other page of the space.
 */
function revalidateWiki({ locale, workspaceSlug }: Context) {
  revalidatePath(`/${locale}/${workspaceSlug}/wiki`, 'layout');
}

/**
 * §20.3.2's save, and §20.3.3's refusal.
 *
 * The refusal is the reason this returns a state rather than redirecting: a
 * stale save has to put both bodies on screen, and a redirect is how the
 * writer's own text gets lost. A *successful* save also stays on the editor and
 * reports its new revision number — §20.3.2's `[S]` asks for "the reader, with a
 * quiet confirmation and the new revision number", and the editor links to the
 * reader rather than throwing the person at it, so a save that turned out to
 * need one more fix does not cost a navigation each way.
 */
export async function savePageAction(
  _previous: WikiPageFormState,
  formData: FormData,
): Promise<WikiPageFormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const baseRevision = Number(formData.get('baseRevision'));
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
    return { error: KEYS.not_found };
  }

  try {
    const result = await saveWikiPage(resolved, {
      pageId: String(formData.get('pageId') ?? ''),
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      baseRevision,
    });

    if (result.ok === false) {
      // The one failure that carries data back rather than only a key.
      return {
        error: KEYS[result.problem],
        current: 'current' in result ? result.current : undefined,
        names: 'names' in result ? (result as { names?: string[] }).names : undefined,
      };
    }

    revalidateWiki(context);
    return { savedAt: Date.now(), revisionNo: result.revisionNo };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

/**
 * §20.3.2's create, which *does* redirect.
 *
 * The opposite call from the save above, and for the opposite reason: there is
 * no body to lose yet, and a create that left somebody on the form would leave
 * them wondering whether it worked. §7.1 makes the same choice for a project.
 */
export async function createPageAction(
  _previous: WikiPageFormState,
  formData: FormData,
): Promise<WikiPageFormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const parentId = String(formData.get('parentId') ?? '');

  try {
    const result = await createPage(resolved, {
      spaceId: String(formData.get('spaceId') ?? ''),
      parentId: parentId.length > 0 ? parentId : null,
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
    });

    if (result.ok === false) {
      return {
        error: KEYS[result.problem],
        names: 'names' in result ? (result as { names?: string[] }).names : undefined,
      };
    }

    revalidateWiki(context);
    redirect({
      href: `/${context.workspaceSlug}/wiki/${result.spaceSlug}/${result.slug}`,
      locale: context.locale,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }

  // `redirect` throws, so this is unreachable — it exists because the compiler
  // cannot know that and a bare `return` here would be a state nothing renders.
  return {};
}

export async function deletePageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await deletePage(resolved, String(formData.get('pageId') ?? ''));
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

export async function restorePageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await restorePage(resolved, String(formData.get('pageId') ?? ''));
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

/**
 * §20.2's restore-as-new-revision.
 *
 * `[!]` §20.11: "restore asks once, then writes a new revision". The asking is
 * the dialog on the history screen; this is what it confirms, and it goes
 * through the ordinary save so §20.3.3's concurrency rule applies to a restore
 * exactly as it does to typing.
 */
export async function restoreRevisionAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const revisionNo = Number(formData.get('revisionNo'));
  const baseRevision = Number(formData.get('baseRevision'));
  if (!Number.isSafeInteger(revisionNo) || !Number.isSafeInteger(baseRevision)) {
    return { error: KEYS.not_found };
  }

  try {
    const result = await restoreRevision(resolved, {
      pageId: String(formData.get('pageId') ?? ''),
      revisionNo,
      baseRevision,
    });
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

export async function movePageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const parentId = String(formData.get('parentId') ?? '');
  const toSpaceId = String(formData.get('toSpaceId') ?? '');

  try {
    const result = await movePage(resolved, {
      pageId: String(formData.get('pageId') ?? ''),
      toSpaceId: toSpaceId.length > 0 ? toSpaceId : undefined,
      parentId: parentId.length > 0 ? parentId : null,
    });
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

/**
 * The sidebar reorder (§20.4).
 *
 * A server action rather than a route handler: §8 grants five Route Handler
 * exceptions and this is none of them — it is not the list query, not §7.5's
 * board drag, not an upload. The board's reorder earns its endpoint because it
 * is a high-frequency gesture several people make at once on the same rows; a
 * sidebar reordered by one person is not that, which is the same distinction
 * §20.4 uses to give it an integer `position` instead of a fractional index.
 */
export async function reorderPagesAction(
  workspaceSlug: string,
  locale: 'en' | 'km',
  input: { spaceId: string; parentId: string | null; orderedIds: string[] },
): Promise<RowActionState> {
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await reorderPages(resolved, input);
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki({ workspaceSlug, locale });
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

export async function renameSpaceAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await renameSpace(resolved, {
      spaceId: String(formData.get('spaceId') ?? ''),
      name: String(formData.get('name') ?? ''),
    });
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

/**
 * §20.2's link, and the thing that makes a wiki get read.
 *
 * It revalidates the *item* page as well as the wiki, because the link appears
 * in both places — §20.2: "A page links to work items and an item lists its
 * pages". A revalidation of one would leave the other showing yesterday's
 * answer, which is the shape of bug that makes a link feel unreliable and
 * therefore unused.
 */
export async function linkPageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await linkPageByIdentifier(resolved, {
      pageId: String(formData.get('pageId') ?? ''),
      identifier: String(formData.get('identifier') ?? ''),
    });
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    // The item page too: the link appears in both places (§20.2), and
    // revalidating one would leave the other showing yesterday's answer — the
    // shape of bug that makes a link feel unreliable and therefore unused.
    revalidatePath(
      `/${context.locale}/${context.workspaceSlug}/projects/${result.projectSlug}`,
      'layout',
    );
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}

export async function unlinkPageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);
  const projectSlug = String(formData.get('projectSlug') ?? '');

  try {
    const result = await unlinkPageFromItem(resolved, {
      pageId: String(formData.get('pageId') ?? ''),
      workItemId: String(formData.get('workItemId') ?? ''),
    });
    if (result.ok === false) return { error: KEYS[result.problem] };

    revalidateWiki(context);
    if (projectSlug.length > 0) {
      revalidatePath(`/${context.locale}/${context.workspaceSlug}/projects/${projectSlug}`, 'layout');
    }
    return { done: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: KEYS.forbidden };
    throw error;
  }
}
