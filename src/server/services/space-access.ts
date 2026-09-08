import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { can, type Actor } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { wikiPage, wikiSpace } from '@/server/db/schema';
import { isArchived, loadProject, projectResource, type ProjectRow } from './project-access';

/**
 * The questions every wiki mutation asks before it does anything (§20.5, §21.6).
 *
 * *Which space is this*, *may this person read it*, *may this person write in
 * it*, and — since slice 21 — *may this person comment in it*. Its own module
 * for the reason `project-access.ts` is one: the wiki
 * service, the attachment service and the search service all need the same
 * answers, and importing one service from another would put a cycle between the
 * thing that creates a page and the thing that stores its images.
 *
 * **The space is the unit of access** (§20.5), which is the sentence the whole
 * module implements. Per-page permissions are refused — "a per-object ACL is a
 * second permission system that has to be joined into every list query, shown in
 * every UI, and explained to the non-technical owner of §2.3" — so there is
 * exactly one place a permission is resolved for a page, and it resolves the
 * page's *space*.
 *
 * **Reading needed no §10 row and writing needed two** (§20.5). That asymmetry
 * is the shape of this file: `canReadSpace` composes rows that already existed,
 * and `canWriteSpace` calls the two actions slice 18 added.
 *
 * **Commenting needed none either** (§21.6), and it is not a third answer but the
 * first one again: "anyone who can read the space may comment in it." What that
 * costs is one clause read cannot need — a view-as session — which
 * `canCommentInSpace` states by hand because there is no §10 action here for the
 * policy module to refuse on its own.
 */

export type SpaceRow = {
  id: string;
  workspaceId: string;
  kind: 'company' | 'project';
  projectId: string | null;
  name: string;
  nameKey: string | null;
  slug: string;
};

/**
 * A space and the project behind it, once resolved.
 *
 * The project is null for the company space and never null for a project space
 * — migration 0032's CHECK guarantees the column, and this type carries the
 * *loaded row*, which can still be null if the project was deleted underneath.
 * Callers treat that as "no such space", which is what it is.
 */
export type SpaceContext = { space: SpaceRow; project: ProjectRow | null };

/** Identifiers, never sentences (§13). */
export type SpaceProblem = 'not_found' | 'archived' | 'forbidden';

/**
 * The space a request names, or null.
 *
 * Null covers "no such space" and "in another workspace" alike — RLS has already
 * made the second indistinguishable from the first, which is the property §15
 * turns into a 404 rather than an empty page.
 */
export async function loadSpace(tx: TenantDb, spaceId: string): Promise<SpaceRow | null> {
  const rows = await tx
    .select({
      id: wikiSpace.id,
      workspaceId: wikiSpace.workspaceId,
      kind: wikiSpace.kind,
      projectId: wikiSpace.projectId,
      name: wikiSpace.name,
      nameKey: wikiSpace.nameKey,
      slug: wikiSpace.slug,
    })
    .from(wikiSpace)
    .where(and(eq(wikiSpace.id, spaceId), isNull(wikiSpace.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/** The same lookup by the slug in the URL. */
export async function loadSpaceBySlug(tx: TenantDb, slug: string): Promise<SpaceRow | null> {
  const rows = await tx
    .select({
      id: wikiSpace.id,
      workspaceId: wikiSpace.workspaceId,
      kind: wikiSpace.kind,
      projectId: wikiSpace.projectId,
      name: wikiSpace.name,
      nameKey: wikiSpace.nameKey,
      slug: wikiSpace.slug,
    })
    .from(wikiSpace)
    .where(and(eq(wikiSpace.slug, slug), isNull(wikiSpace.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * A space with its project loaded, ready for both questions below.
 *
 * One function rather than two lookups at each call site, so a caller cannot
 * ask about reading with the project loaded and about writing without it.
 */
export async function resolveSpace(tx: TenantDb, spaceId: string): Promise<SpaceContext | null> {
  const space = await loadSpace(tx, spaceId);
  if (!space) return null;
  return withProject(tx, space);
}

export async function withProject(tx: TenantDb, space: SpaceRow): Promise<SpaceContext | null> {
  if (space.kind === 'company') return { space, project: null };
  if (space.projectId === null) return null;

  const project = await loadProject(tx, space.projectId);
  // A project space whose project is gone is not a space anybody can resolve a
  // permission for. The foreign key cascades, so this is the window between a
  // delete and this read rather than a durable state.
  if (!project) return null;

  return { space, project };
}

/**
 * The space a page belongs to, with its project loaded.
 *
 * The one lookup that turns a page id into a permission answer, and it is here
 * rather than in `wiki.ts` because `attachments.ts` needs it too — a screenshot
 * pasted into a page is governed by that page's space (§20.9), and a helper
 * imported from the wiki service into the attachment service would put a cycle
 * between the thing that writes a page and the thing that stores its images.
 *
 * The page's own soft delete is applied: a file in a deleted page is not
 * reachable, which is what makes §20.3.6's 30-day window a window rather than a
 * loophole.
 */
export async function resolvePageSpace(
  tx: TenantDb,
  pageId: string,
): Promise<SpaceContext | null> {
  const rows = await tx
    .select({ spaceId: wikiPage.spaceId })
    .from(wikiPage)
    .where(and(eq(wikiPage.id, pageId), isNull(wikiPage.deletedAt)))
    .limit(1);

  const row = rows[0];
  return row ? resolveSpace(tx, row.spaceId) : null;
}

/**
 * May this person read the space (§20.5)?
 *
 * **No §10 row, because reading follows the space's container.** A project
 * space is `project.view` — "already written, already composed by
 * `effectiveProjectRole`, already the thing a Guest is safely bounded by". The
 * company space is "readable by every workspace member and not by Guests, which
 * is the line §10 already draws at *See workspace-visible projects*".
 *
 * That second clause is expressed here rather than as a policy action, because
 * it is not a new question: it is the same cap the matrix already places on a
 * Guest, applied to the one container that has no project to ask about.
 */
export function canReadSpace(actor: Actor, context: SpaceContext): boolean {
  if (context.space.workspaceId !== actor.workspaceId) return false;

  if (context.space.kind === 'company') return actor.workspaceRole !== 'guest';

  return context.project !== null && can(actor, 'project.view', projectResource(context.project));
}

/**
 * May this person write in the space (§20.5)?
 *
 * The two new rows, and the only place either is asked. A project space's
 * answer needs the project; the company space's is workspace-wide, which is why
 * the two actions have different resource types.
 */
export function canWriteSpace(actor: Actor, context: SpaceContext): boolean {
  if (context.space.workspaceId !== actor.workspaceId) return false;

  if (context.space.kind === 'company') return can(actor, 'wiki.write_company_space');

  return (
    context.project !== null &&
    can(actor, 'wiki.write_project_space', projectResource(context.project))
  );
}

/**
 * May this person **comment** in the space (§21.6)?
 *
 * "Anyone who can read the space may comment in it, which for a project space
 * includes a Guest who can see the project — deliberately, because the whole
 * value of a comment on documentation comes from the person who found it wrong,
 * and that is disproportionately the newest person in the room."
 *
 * So it is `canReadSpace` plus one thing that read does not need, and the extra
 * clause is the interesting half. **A view-as session is refused here by hand**,
 * where every other mutation in the wiki gets that refusal for free: `can()`
 * denies every action carrying `mutation: true` while `readOnly` is set (§7.13),
 * and there is no §10 action to ask about here — §21.6 says so in as many words
 * ("§10's `comment.create` and `comment.delete_others` … need **no new row**").
 * A rule that is not an action does not reach the module that enforces the
 * read-only session, so this states it.
 *
 * The database refuses underneath either way — every tenant table's `INSERT`
 * policy carries `and not tenancy.is_read_only()` — but a service that leaves it
 * to the policy reports a Postgres error where §11 asks for a sentence.
 */
export function canCommentInSpace(actor: Actor, context: SpaceContext): boolean {
  return !actor.readOnly && canReadSpace(actor, context);
}

/**
 * May this person delete **somebody else's** comment here (§10, §21.6)?
 *
 * No new row — the sixteenth time that decision has gone the same way. A project
 * space asks `comment.delete_others`, which is the row that already governs the
 * same act on that project's work items. The company space has no project to ask
 * about, so it asks `wiki.write_company_space`, which is the row §20.5 added for
 * the one container that has no project — and which resolves to the same
 * Admin-and-above set that "Delete others' comments" gives a project Lead.
 *
 * Both are mutations, so a view-as session is refused by the policy module here
 * without this function saying anything, unlike `canCommentInSpace` above.
 */
export function canModerateSpace(actor: Actor, context: SpaceContext): boolean {
  if (context.space.workspaceId !== actor.workspaceId) return false;

  if (context.space.kind === 'company') return can(actor, 'wiki.write_company_space');

  return (
    context.project !== null &&
    can(actor, 'comment.delete_others', projectResource(context.project))
  );
}

/**
 * The refusal a comment should report, or null when it may proceed.
 *
 * `checkSpaceWrite`'s shape and the same three outcomes, differing only in the
 * last question — which is the whole of §21.6's "one thing is genuinely new".
 * A separate function rather than a flag on that one, so a call site cannot ask
 * the write question and get the comment answer by passing the wrong boolean.
 */
export function checkSpaceComment(actor: Actor, context: SpaceContext): SpaceProblem | null {
  if (!canReadSpace(actor, context)) return 'not_found';

  // §4's archived rule names comments explicitly — "no new items, no edits, no
  // state changes, no comments" — and it reaches the wiki through the project a
  // space documents, exactly as it does for a write.
  if (context.project !== null && isArchived(context.project)) return 'archived';

  return canCommentInSpace(actor, context) ? null : 'forbidden';
}

/**
 * The refusal a write should report, or null when it may proceed.
 *
 * Three outcomes rather than a boolean, because §11 asks for a sentence and
 * "you cannot see this space", "this project is archived" and "you may read but
 * not write here" are three different ones. `not_found` rather than `forbidden`
 * for an unreadable space, so a Guest cannot enumerate a company's spaces by
 * watching which slugs answer differently — the same reasoning slice 16's 404
 * uses when it declines to distinguish "no such workspace" from "not yours".
 */
export function checkSpaceWrite(actor: Actor, context: SpaceContext): SpaceProblem | null {
  if (!canReadSpace(actor, context)) return 'not_found';

  /**
   * §4's archived rule reaches the wiki through the project it documents.
   *
   * An archived project is read-only "no new items, no edits, no state changes,
   * no comments" — and its documentation is part of what is frozen, because a
   * project somebody archived is a project nobody should still be revising the
   * handbook of. The company space has no project and is never archived.
   */
  if (context.project !== null && isArchived(context.project)) return 'archived';

  return canWriteSpace(actor, context) ? null : 'forbidden';
}
