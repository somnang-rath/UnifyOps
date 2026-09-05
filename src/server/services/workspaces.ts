import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { isUniqueViolation } from '@/server/db/errors';
import { withIdentity } from '@/server/db/identity';
import { team, workspace as workspaceTable, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { deriveSlug, slugify, slugProblem, type SlugProblem } from '@/lib/slug';
import { horizonYears } from '@/lib/holidays';
import { todayIn } from '@/lib/workspace-date';
import { seedHolidaysInTx } from './holidays';
import { ensureCompanySpace } from './wiki';

/**
 * What a brand-new workspace is, before anybody opens Settings.
 *
 * Both mirror the column defaults in `schema/workspace.ts` and exist here
 * because signup needs them *before* the row is readable back. Two constants
 * that must agree with two defaults is one more coupling than ideal; the
 * alternative is a `RETURNING` round trip on the one path §7.1 measures with a
 * stopwatch.
 */
const DEFAULT_TIMEZONE = 'Asia/Phnom_Penh';
const DEFAULT_LOCALE = 'en' as const;

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

      /*
       * §18-10's "seed the current and next year at signup" (§6-1, §17-18).
       *
       * Here rather than on first visit to Settings, because the calendar is
       * read by arithmetic that starts running immediately — a workspace
       * created on 10 April with an empty calendar computes Khmer New Year as
       * four ordinary working days, and nobody opens Settings in their first
       * week. §6's governing rule is that a company which never opens Settings
       * must be completely fine, and for this one table that means arriving
       * with rows in it.
       *
       * Only the fixed-date holidays, and only for a timezone whose calendar we
       * actually hold — see `src/lib/holidays.ts` for why the moveable ones are
       * named on the screen and never dated here. A new workspace defaults to
       * `Asia/Phnom_Penh`, so in practice this is the market §2.5 describes; a
       * company that changes its zone later seeds from Settings.
       *
       * Written in the company's own language, which at signup is the product
       * default — the holiday name is a literal, not a `name_key`, because
       * there is no English default it would be right to fall back to (§13).
       */
      await seedHolidaysInTx(tx, uow, {
        workspaceId,
        timezone: DEFAULT_TIMEZONE,
        locale: DEFAULT_LOCALE,
        years: horizonYears(todayIn(DEFAULT_TIMEZONE)),
      });

      /**
       * §20.2's company space, seeded here beside the default team, the default
       * workflow states and the holiday calendar.
       *
       * "One **company space** per workspace, seeded at signup." It carries a
       * `name_key` rather than a literal, which is §13's awkward middle and the
       * same call `DEFAULT_TEAM` above makes: it renders translated until
       * somebody renames it, and the rename clears the key so their literal wins
       * for good. That is the opposite of the holiday seeded four lines up — and
       * correctly, because "Company" has an English default it is right to fall
       * back to, where Khmer New Year does not.
       *
       * §6's governing rule is that "a company that never opens Settings must be
       * completely fine", and the wiki's version of it is that a company that
       * never opens `/wiki` still has a space waiting when they do. Empty, which
       * §20.11 says "reads as empty, not as broken".
       */
      await ensureCompanySpace(tx, uow, workspaceId);

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
