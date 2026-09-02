import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { isUniqueViolation } from '@/server/db/errors';
import { withIdentity } from '@/server/db/identity';
import { team, workspace as workspaceTable, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { deriveSlug, slugify, slugProblem, type SlugProblem } from '@/lib/slug';

/**
 * Creating a company (§7.1).
 *
 * The one flow that has to touch two connections, and the reason is structural:
 * a workspace cannot be inserted by a connection already scoped to a workspace,
 * because there is not one yet. So the root row goes in on the identity
 * connection, and everything after it — the owner's membership, the audit trail
 * — goes through a normal `withActor` scoped to the workspace that now exists.
 * The tenant tables keep their single write path.
 */

/**
 * The team every new workspace starts with (§6).
 *
 * Exported because `createProject` falls back to it: a workspace created before
 * slice 4, or one whose only team was deleted, still has to be able to hold a
 * project, and the fallback must produce the same team this does rather than a
 * second one that looks almost like it.
 */
export const DEFAULT_TEAM = {
  slug: 'general',
  /** The English fallback. `nameKey` is what a person actually reads until a rename. */
  name: 'General',
  nameKey: 'defaultTeam.general',
} as const;

export type CreateWorkspaceInput = {
  ownerUserId: string;
  name: string;
  /** Optional. §7.1: the slug is auto-derived from the name and editable. */
  slug?: string;
};

export type CreateWorkspaceProblem = 'name_required' | SlugProblem | 'slug_taken';

export type CreateWorkspaceResult =
  | { ok: true; workspaceId: string; slug: string; memberId: string }
  /** An identifier, not a sentence. The sentences are translated (§13). */
  | { ok: false; problem: CreateWorkspaceProblem };

/** Slugs already taken that start with `base`, so a suffix can be chosen. */
async function takenSlugsLike(base: string): Promise<Set<string>> {
  const rows = await withIdentity(async (tx) =>
    tx
      .select({ slug: workspaceTable.slug })
      .from(workspaceTable)
      // Anchored prefix match with the wildcards escaped, so a company called
      // "100%" cannot turn this into a table scan that matches everything.
      .where(sql`${workspaceTable.slug} like ${`${base.replace(/[%_\\]/g, '\\$&')}%`}`),
  );

  return new Set(rows.map((r) => r.slug));
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  // NFC before storing, so a Khmer name typed with a different composition
  // sequence compares and sorts as the same string it looks like (§13).
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };

  let slug: string;
  if (input.slug !== undefined && input.slug.trim() !== '') {
    // A slug the user typed is validated, never silently rewritten: they are
    // looking at the field, and a value that changes under them reads as a bug.
    slug = slugify(input.slug);
    const problem = slugProblem(slug);
    if (problem) return { ok: false, problem };
  } else {
    const base = slugify(name);
    slug = deriveSlug(name, await takenSlugsLike(base || 'workspace'));
  }

  const workspaceId = uuidv7();
  const memberId = uuidv7();
  const teamId = uuidv7();

  try {
    await withIdentity(async (tx) => {
      await tx.insert(workspaceTable).values({ id: workspaceId, slug, name });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'slug_taken' };
    throw error;
  }

  // If this fails, the workspace row above survives with no members. That is
  // deliberate rather than compensated: the alternative is granting the identity
  // role either DELETE on workspace or INSERT on workspace_member, and the
  // second of those would let a bug add the current user to any company in the
  // product. An unreachable row that holds a slug is the smaller problem, and
  // it is visible — a workspace with no owner is a query, not a mystery.
  await withActor(
    {
      workspaceId,
      userId: input.ownerUserId,
      actorUserId: input.ownerUserId,
      readOnly: false,
    },
    async (tx, uow) => {
      await tx.insert(workspaceMember).values({
        id: memberId,
        workspaceId,
        userId: input.ownerUserId,
        role: 'owner',
      });

      // The one seeded default a new workspace gets (§6). A project belongs to
      // a team, and asking someone to create a team before they can create a
      // project would put a configuration step inside the three-minute path
      // §7.1 measures. It carries a message key rather than a bare literal, so
      // a Khmer workspace does not open on the English word "General"; renaming
      // it clears the key and the name they typed wins (§13).
      await tx.insert(team).values({
        id: teamId,
        workspaceId,
        slug: DEFAULT_TEAM.slug,
        name: DEFAULT_TEAM.name,
        nameKey: DEFAULT_TEAM.nameKey,
      });

      uow.emit({ type: 'workspace.created', workspaceId, slug, name });
      uow.emit({
        type: 'workspace_member.added',
        workspaceId,
        memberId,
        userId: input.ownerUserId,
        role: 'owner',
      });
      uow.emit({
        type: 'team.created',
        workspaceId,
        teamId,
        slug: DEFAULT_TEAM.slug,
        name: DEFAULT_TEAM.name,
      });
    },
  );

  return { ok: true, workspaceId, slug, memberId };
}

/** Whether a slug is free. Used by the onboarding field as the user types. */
export async function isSlugAvailable(candidate: string): Promise<boolean> {
  const slug = slugify(candidate);
  if (slugProblem(slug)) return false;

  const rows = await withIdentity(async (tx) =>
    tx
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(eq(workspaceTable.slug, slug))
      .limit(1),
  );

  return rows.length === 0;
}
