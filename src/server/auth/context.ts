import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import type { AccentColor } from '@/lib/branding';
import { locales, type Locale } from '@/i18n/routing';
import { isWeekDay, type WeekDay } from '@/lib/workspace-date';
import { can, type Actor } from '@/server/authz/policy';
import { withIdentity } from '@/server/db/identity';
import {
  projectMember,
  user as userTable,
  workspace as workspaceTable,
  workspaceMember,
} from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';
import { countUnread } from '@/server/queries/notifications';
import type { ProjectRole, WorkspaceRole } from '@/server/authz/roles';
import { readCurrentUser } from './session';
import type { CurrentUser } from './session';
import { readViewAs } from './view-as';

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * Resolving who is acting, once per request, into the two shapes the rest of
 * the server takes.
 *
 * They are deliberately separate objects: `ActorContext` is what the database
 * needs (§9 — the transaction-local tenancy variables), `Actor` is what the
 * policy module needs (§10 — the permission matrix). Same person, two
 * questions: *whose data is this* and *may they do this*. Collapsing them into
 * one type is how a codebase ends up answering the second question with the
 * first one's information.
 *
 * View-as (§7.13) is the case that proves they are separate, and slice 15 is
 * where it stopped being a seam. It makes `userId` the target member in both
 * while `actorUserId` stays the viewer, and sets `readOnly` on both — so the
 * database scopes rows as the target, the policy module answers as the target,
 * the audit log names the viewer, and every mutation is refused twice.
 *
 * **The decision is re-taken on every request**, from the cookie plus the
 * session's own membership. There is no server-side view-as state to go stale,
 * so an owner who loses Admin mid-session stops viewing on their next click
 * rather than whenever something notices.
 */

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  /**
   * The company's timezone (§6-1), carried on every resolved actor because
   * every date the product asserts something about is evaluated in it (§4).
   * Resolved once here rather than fetched by whichever screen needs it, so no
   * screen can quietly fall back to the viewer's device (§17-13).
   */
  timezone: string;
  /**
   * The company's language (§6-1, slice 15) — the fallback, never a person's
   * own. Carried here for the one caller that genuinely needs it on the server:
   * the holiday seed writes a literal that every member will read, so it must
   * be written in the company's language rather than in whichever one the admin
   * who pressed the button happened to be using.
   */
  defaultLocale: Locale;
  /**
   * §6-1's week start, 0 = Monday through 6 = Sunday — the schema's numbering,
   * not JavaScript's.
   *
   * Carried beside `timezone` and for the same reason: the calendar is drawn on
   * a page that already resolved an actor, and a view that fetched this itself
   * would be a second round trip for a value the shell had in hand. Slice 12
   * hardcoded Monday here and said the setting was slice 15's.
   */
  weekStart: WeekDay;
  /** §6-7's accent, or null for the product's own. The layout puts it on an attribute. */
  accent: AccentColor | null;
  /** §6-7's logo, as an object key. Null until somebody uploads one. */
  logoKey: string | null;
};

/**
 * Who is being viewed, while §7.13's view-as is active.
 *
 * Present on the resolved actor rather than fetched by the bar, because the
 * decision to *be* in a view-as session and the information needed to say so
 * are the same decision — a bar that asked its own question could disagree with
 * the context every other component on the page was rendered from, which is
 * precisely the "correct-looking screen over an incorrect query" §7.13 exists
 * to catch.
 */
export type ViewAsState = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

/**
 * One row of the workspace switcher — deliberately narrower than
 * `WorkspaceSummary`.
 *
 * The switcher needs a name and a link; the settings a workspace carries mean
 * nothing outside it. Keeping this small is what stops the one cross-workspace
 * query in the product from growing a column every time a slice adds a company
 * setting.
 */
export type WorkspaceListing = Pick<WorkspaceSummary, 'id' | 'slug' | 'name' | 'role'> & {
  timezone: string;
};

/**
 * Every workspace this user belongs to.
 *
 * The one query in the product that spans workspaces on purpose, which is why
 * it runs on the identity connection: no single tenant scope can answer it, and
 * the `identity_select_own` policy narrows it to this user's own membership rows
 * — so it cannot become a way to read who else is in them.
 */
export const listMyWorkspaces = cache(
  async (userId: string): Promise<WorkspaceListing[]> =>
    withIdentity(
      async (tx) =>
        tx
          .select({
            id: workspaceTable.id,
            slug: workspaceTable.slug,
            name: workspaceTable.name,
            timezone: workspaceTable.timezone,
            role: workspaceMember.role,
          })
          .from(workspaceMember)
          .innerJoin(workspaceTable, eq(workspaceTable.id, workspaceMember.workspaceId))
          .where(and(eq(workspaceMember.userId, userId), isNull(workspaceMember.deletedAt)))
          .orderBy(workspaceTable.name),
      { userId },
    ),
);

/**
 * This member's explicit project roles, keyed by project id (slice 4).
 *
 * On the app connection rather than the identity one, and that is not an
 * oversight: `project_member` is tenant data — it says what a company is doing
 * and who is doing it — and the handshake role is granted nothing on it by
 * name, so it cannot read it at all. By the time this runs the workspace is
 * known and `withActor` is the right tool.
 *
 * One extra query per request, deduplicated by `resolveActorContext` being
 * `cache`d, and it is what makes §10 answerable at all: without the map, every
 * project would resolve to whatever the workspace role implies and an explicit
 * Lead would be indistinguishable from a Member.
 */
/**
 * The two things every workspace screen needs from the app connection, in one
 * transaction.
 *
 * They are unrelated questions — §10's explicit project memberships, and §7.8's
 * unread count for the bell — and they are asked together for the reason slice
 * 8 folded the mentionable list into `getCommentThread`: each one is a round
 * trip on every navigation, and the shell renders on *every* screen. Two
 * transactions per page view was enough to push project creation past its
 * assertion under a parallel end-to-end run, which is the visible edge of a
 * cost every real page load was also paying.
 */
async function loadShellState(
  context: ActorContext,
  memberId: string,
): Promise<{ projectRoles: ReadonlyMap<string, ProjectRole>; unread: number }> {
  return withActor(context, async (tx) => {
    const rows = await tx
      .select({ projectId: projectMember.projectId, role: projectMember.role })
      .from(projectMember)
      .where(
        and(eq(projectMember.workspaceMemberId, memberId), isNull(projectMember.deletedAt)),
      );

    return {
      projectRoles: new Map(rows.map((row) => [row.projectId, row.role])),
      unread: await countUnread(tx, memberId),
    };
  });
}

export type ResolvedActor = {
  user: CurrentUser;
  workspace: WorkspaceSummary;
  memberId: string;
  /**
   * Unread notifications for the bell (§7.8), resolved with the rest of the
   * shell's state rather than by its own query. Correct as of this request; the
   * badge moves on the next navigation, which is what §8 already accepts for
   * everything that is not the board.
   */
  unread: number;
  /** For `withActor` — the database's question. */
  context: ActorContext;
  /** For `can` / `assertCan` — the policy module's question. */
  actor: Actor;
  /**
   * The person whose screens these are, while §7.13's view-as is active — and
   * null the rest of the time, which is almost always.
   *
   * When it is set, `workspace.role`, `memberId`, `actor` and `context` all
   * describe **them**, not the viewer. That is the whole of §7.13's "it is a
   * real actor context, not a UI filter": a filter would show the owner a
   * correct-looking screen over an incorrect query, which is exactly the bug
   * they opened the screen to find.
   */
  viewAs: ViewAsState | null;
  /** The viewer's own identity while viewing as somebody else. */
  viewer: CurrentUser | null;
  /**
   * §7.13's `[!]`: "the member is removed mid-session → view-as ends with an
   * explanation, not a 404."
   *
   * Set when a cookie named somebody who is no longer a member. The session
   * silently reverts to the viewer's own — the alternative is a screen that
   * cannot render — and the bar says why instead of vanishing without comment.
   */
  viewAsEnded: boolean;
};

/**
 * The membership behind a workspace URL, or null.
 *
 * Null covers both "no such workspace" and "not a member of it", and the caller
 * turns both into the same 404. That is deliberate: distinguishing them tells
 * an outsider which company slugs exist, and §15 asks a pasted URL from another
 * workspace to 404 rather than to show an empty page.
 */
export const resolveActorContext = cache(
  async (workspaceSlug: string): Promise<ResolvedActor | null> => {
    const user = await readCurrentUser();
    if (!user) return null;

    const found = await withIdentity(
      async (tx) => {
        const rows = await tx
          .select({
            workspaceId: workspaceTable.id,
            slug: workspaceTable.slug,
            name: workspaceTable.name,
            timezone: workspaceTable.timezone,
            defaultLocale: workspaceTable.defaultLocale,
            weekStart: workspaceTable.weekStart,
            accent: workspaceTable.accent,
            logoKey: workspaceTable.logoKey,
            memberId: workspaceMember.id,
            role: workspaceMember.role,
          })
          .from(workspaceMember)
          .innerJoin(workspaceTable, eq(workspaceTable.id, workspaceMember.workspaceId))
          .where(
            and(
              eq(workspaceMember.userId, user.id),
              eq(workspaceTable.slug, workspaceSlug),
              isNull(workspaceMember.deletedAt),
              isNull(workspaceTable.deletedAt),
            ),
          )
          .limit(1);

        return rows[0] ?? null;
      },
      { userId: user.id },
    );

    if (!found) return null;

    const company = {
      id: found.workspaceId,
      slug: found.slug,
      name: found.name,
      timezone: found.timezone,
      defaultLocale: (isLocale(found.defaultLocale) ? found.defaultLocale : 'en') as Locale,
      // The column is bounded 0..6 by a CHECK in migration 0028; the narrowing
      // is here so a row written before that constraint existed cannot make a
      // calendar draw eight columns.
      weekStart: (isWeekDay(found.weekStart) ? found.weekStart : 0) as WeekDay,
      accent: found.accent,
      logoKey: found.logoKey,
    };

    /*
     * §7.13, and the reason the two context objects have always been separate.
     *
     * The cookie is a *claim*. It becomes an actor only if the viewer still
     * holds `workspace.view_as_member` in this workspace and the person they
     * named is still a live member of it — both re-asked here, on every
     * request, from the session's own membership. Nothing about the cookie is
     * trusted; it names a session the viewer could have started by clicking.
     *
     * The permission is asked of a **real** actor built from the viewer's own
     * role, deliberately with no project roles: `workspace.view_as_member` is a
     * workspace-level rule (§10, Owner and Admin), and handing the check a map
     * it does not read would suggest it did. `readOnly: false` there for the
     * same reason — the question is whether this person may *start* a session,
     * and asking it as though they were already inside one would refuse it,
     * since every action is a mutation to a read-only actor.
     */
    const claim = await readViewAs();
    const wants =
      claim !== null &&
      claim.workspaceId === found.workspaceId &&
      claim.memberId !== found.memberId &&
      can(
        {
          workspaceId: found.workspaceId,
          userId: user.id,
          workspaceRole: found.role,
          projectRoles: new Map(),
          readOnly: false,
        },
        'workspace.view_as_member',
      );

    // The viewer's own context, which is also what the lookup below runs on:
    // resolving the target is a question the *viewer* asks, and asking it from
    // inside the session being set up would be circular.
    const ownContext: ActorContext = {
      workspaceId: found.workspaceId,
      userId: user.id,
      actorUserId: user.id,
      readOnly: false,
    };

    const target = wants && claim ? await readTargetMember(ownContext, claim.memberId) : null;

    // A cookie that named somebody who has since been removed. §7.13's `[!]`
    // asks for "an explanation, not a 404", so the session reverts and the bar
    // says so — the cookie itself is cleared by the bar's action, because a
    // cached render is not allowed to write one.
    const viewAsEnded = wants && target === null;

    const readOnly = target !== null;
    const actingUserId = target?.userId ?? user.id;
    const actingMemberId = target?.memberId ?? found.memberId;
    const actingRole = target?.role ?? found.role;

    const context: ActorContext = target
      ? {
          workspaceId: found.workspaceId,
          // The target in `userId` and the viewer in `actorUserId` — which is
          // exactly what §18-11 built `audit_record.on_behalf_of_user_id` for,
          // and why a view-as session is visible in the log rather than
          // indistinguishable from the person being viewed.
          userId: actingUserId,
          actorUserId: user.id,
          readOnly: true,
        }
      : ownContext;

    const shell = await loadShellState(context, actingMemberId);

    return {
      user,
      unread: shell.unread,
      workspace: { ...company, role: actingRole },
      memberId: actingMemberId,
      context,
      actor: {
        workspaceId: found.workspaceId,
        userId: actingUserId,
        workspaceRole: actingRole,
        // Explicit project memberships only. §10 composition derives the
        // implicit roles from this — Owner and Admin are Leads everywhere, a
        // workspace-visible project grants Members a Viewer, Guests get nothing
        // — and none of that is ever written into this map.
        projectRoles: shell.projectRoles,
        readOnly,
      },
      viewAs: target,
      viewer: target ? user : null,
      viewAsEnded,
    };
  },
);

/**
 * The member a view-as cookie names, read as the viewer.
 *
 * On the app connection, like `loadShellState` and for the same reason: this is
 * tenant data, the workspace is known by now, and the identity role is granted
 * nothing that would let it read another member's row.
 *
 * A live membership only. §7.12 soft-deletes a removed member, so this is the
 * check that turns "viewing as somebody who left" into §7.13's explanation
 * rather than into a session with no owner.
 */
async function readTargetMember(
  context: ActorContext,
  memberId: string,
): Promise<ViewAsState | null> {
  return withActor(context, async (tx) => {
    const rows = await tx
      .select({
        memberId: workspaceMember.id,
        userId: workspaceMember.userId,
        role: workspaceMember.role,
        name: userTable.name,
        email: userTable.email,
      })
      .from(workspaceMember)
      .innerJoin(userTable, eq(userTable.id, workspaceMember.userId))
      .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  });
}
