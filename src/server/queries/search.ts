import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { project, user, workspaceMember, workItem } from '@/server/db/schema';
import { toLikePattern } from '@/lib/search';

/**
 * The two questions §7.9 asks that the §9 list query cannot (slice 14).
 *
 * Work items are **not** here, and that absence is the slice's main structural
 * decision. Searching work is one filter on the one builder — `q` in the DSL,
 * one branch in `wherePredicate` — so it inherits the counts query, the keyset
 * cursors, the archived default and §10's per-row re-check rather than becoming
 * a second query with its own opinions about all four. What is left over is
 * people, who are not work items, and a direct `ENG-142` lookup, which is not a
 * search at all: it is a unique-index probe whose answer is a destination.
 *
 * Projects are not here either, for a different reason: `listProjects` already
 * answers "which projects may this person see" as a SQL predicate re-checked
 * through the policy module, and a workspace holds tens of them. Filtering that
 * list in TypeScript is one round trip fewer *and* — the part that matters —
 * cannot drift from §10's visibility rules, which a second predicate written
 * here eventually would. The trigram index on `lower(project.name)` in migration
 * 0026 is there for the day that stops being true, not for today.
 */

export type PersonHit = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  /** Rendered as "left the company" rather than hidden — see below. */
  active: boolean;
};

/**
 * §7.9's People section.
 *
 * Both scripts take the same route, unlike work items, and the asymmetry is
 * deliberate rather than an omission: a name is two or three words, so lexeme
 * matching buys nothing a substring match does not already give, and "sop"
 * finding "Sophea" is the behaviour anybody typing into a palette expects.
 * Matching the email as well is what makes the palette useful the moment
 * somebody pastes an address out of a chat.
 *
 * Both sides are folded — `lower()` on the columns, `toLikePattern` on the
 * needle — rather than `ILIKE`, for the reason the whole slice folds: the same
 * comparison shape everywhere, and the one that an index can serve if this table
 * ever grows enough to need one (0026 explains why it has none today).
 *
 * **Former members are found and marked, not hidden.** Migration 0009 widened
 * `app_user`'s policy precisely so somebody who has left still resolves in the
 * history they wrote (§7.12: "activity history is preserved and attributed"), and
 * a palette that cannot find the person whose comment you are reading is a
 * palette that looks broken. The caller decides what to do with `active`; the
 * one thing it must not do is offer them as an assignee.
 */
export async function findPeople(
  tx: TenantDb,
  text: string,
  limit: number,
): Promise<PersonHit[]> {
  const pattern = toLikePattern(text);

  return tx
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      // An account with no name still has to be nameable in a list, so the
      // address stands in until they fill one in — the same coalesce
      // `readPeople` makes, for the same reason.
      name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
      email: user.email,
      active: sql<boolean>`${workspaceMember.deletedAt} is null`,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        isNull(user.deletedAt),
        sql`(lower(${user.name}) like ${pattern} or lower(${user.email}) like ${pattern})`,
      ),
    )
    // Current members first, then by name. A palette that lists a leaver above
    // the colleague sitting next to you is one people stop trusting; ordering
    // says so without hiding anything.
    .orderBy(sql`${workspaceMember.deletedAt} is not null`, user.name)
    .limit(limit);
}

export type ItemReferenceHit = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectSlug: string;
  projectKey: string;
  projectVisibility: 'workspace' | 'private';
  projectWorkspaceId: string;
  /** True when the project is archived. The lookup still resolves — see below. */
  archived: boolean;
};

/**
 * `ENG-142` — §7.9's short-circuit, as a unique-index probe.
 *
 * "A direct `ENG-142` lookup always resolves regardless of either — that is the
 * entire reason identifiers are never reused." *Either* means an archived project
 * and the include-archived toggle: this query applies neither, because the point
 * of a permanent identifier is that pasting it into a palette gets you to the
 * thing, and a person who typed an exact identifier has already told us which
 * item they mean.
 *
 * What it does **not** bypass is deletion or permission. `deleted_at is null`
 * is applied here — §7.9: "soft-deleted items never appear in search and are
 * reachable only from the 30-day recovery screen" — and the caller re-checks
 * §10 on the project before it hands the answer back, which is why the row
 * carries the three columns `can(..., 'project.view', ...)` needs.
 *
 * The key comparison is case-folded because `parseItemReference` upper-cases and
 * `normalizeProjectKey` guarantees stored keys are upper-case; folding both
 * sides costs nothing and removes the one way those two could ever disagree.
 */
export async function findItemByReference(
  tx: TenantDb,
  key: string,
  number: number,
): Promise<ItemReferenceHit | null> {
  const rows = await tx
    .select({
      id: workItem.id,
      number: workItem.number,
      title: workItem.title,
      projectId: project.id,
      projectSlug: project.slug,
      projectKey: project.key,
      projectVisibility: project.visibility,
      projectWorkspaceId: project.workspaceId,
      archived: sql<boolean>`${project.archivedAt} is not null`,
    })
    .from(workItem)
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(
      and(
        sql`upper(${project.key}) = ${key}`,
        eq(workItem.number, number),
        isNull(workItem.deletedAt),
        isNull(project.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
