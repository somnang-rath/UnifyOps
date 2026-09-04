import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import {
  CHANNELS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_KINDS,
  effectiveDefaults,
  isNotificationChannel,
  isNotificationKind,
} from '@/lib/notification-kinds';
import type {
  NotificationChannel,
  NotificationKind,
  PreferenceMap,
} from '@/lib/notification-kinds';
import type { ResolvedActor } from '@/server/auth/context';
import { notificationPreference, workspaceNotificationDefault } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import type { TenantDb } from '@/server/db/client';
import { assertCan } from '@/server/authz/policy';
import {
  countUnread,
  fetchInbox,
  markAllRead,
  setNotificationRead,
} from '@/server/queries/notifications';

import type { InboxPage } from '@/server/queries/notifications';

/**
 * The inbox and its preferences (§7.8, §6-6).
 *
 * **There is no §10 row for notifications, and none was invented.** The same
 * decision slice 5 made for labels and slice 8 for attachments: the permission
 * matrix is a table a non-technical owner is shown, and adding a line to the
 * code that the table does not contain is how the two stop describing the same
 * product. Every operation here is somebody acting on their own inbox, which no
 * role has ever needed permission for — and which no role can be granted over
 * somebody else's, because every query is keyed on the acting member's id in
 * the predicate as well as by RLS.
 *
 * **There is deliberately no `getUnreadCount`.** The bell is on every workspace
 * screen, so a service opening its own transaction for it would add a round trip
 * to every navigation in the product. `resolveActorContext` already opens a
 * `withActor` for the actor's project roles and the count rides in it — same
 * request, same transaction, same answer. See `loadShellState` in
 * `src/server/auth/context.ts`.
 */

/** One screen of inbox. §7.8's "500 notifications → paginated" starts here. */
const PAGE_SIZE = 30;

export type Inbox = InboxPage & { unread: number };

/**
 * One page of the acting member's inbox, plus the badge.
 *
 * Both in one transaction because the page and the count are one answer: read
 * separately, a "mark all read" landing between them shows a badge of 12 above
 * a list with nothing unread in it.
 */
export async function getInbox(
  resolved: ResolvedActor,
  input: { cursor?: string | null } = {},
): Promise<Inbox> {
  return withActor(resolved.context, async (tx) => {
    const page = await fetchInbox(tx, {
      memberId: resolved.memberId,
      limit: PAGE_SIZE,
      cursor: input.cursor,
    });

    return { ...page, unread: await countUnread(tx, resolved.memberId) };
  });
}

export type Ok = { ok: true };
export type Failed = { ok: false; problem: string };

/**
 * Mark one entry read or unread.
 *
 * A missing row is `not_found` rather than a silent success: the row is either
 * somebody else's or gone, and both are worth the caller knowing. Unlike most
 * refusals in the product this one cannot be a permission problem — there is no
 * permission — so there is one reason and it is honest.
 */
export async function markNotificationRead(
  resolved: ResolvedActor,
  input: { notificationId: string; read: boolean },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const done = await setNotificationRead(tx, {
      memberId: resolved.memberId,
      notificationId: input.notificationId,
      read: input.read,
    });

    return done ? ({ ok: true } as const) : ({ ok: false, problem: 'not_found' } as const);
  });
}

/**
 * §7.8: "'mark all read' acts on all" — every unread row this member has, not
 * the page in front of them. See the note in `queries/notifications.ts`.
 */
export async function markInboxRead(resolved: ResolvedActor): Promise<Ok> {
  return withActor(resolved.context, async (tx) => {
    await markAllRead(tx, resolved.memberId);
    return { ok: true } as const;
  });
}

export type PreferenceView = {
  kind: NotificationKind;
  /** Which channels this kind can use at all — the digest is email-only. */
  available: readonly NotificationChannel[];
  /** Which are on for this person, saved or defaulted. */
  enabled: readonly NotificationChannel[];
  /** True when a row exists, so the screen can say "default" rather than imply a choice. */
  customised: boolean;
};

/**
 * Every kind, in the order the screen renders them, whether or not a row exists.
 *
 * Built from `NOTIFICATION_KINDS` rather than from what is in the table, so a
 * kind added in a later slice appears on everybody's screen at its default the
 * day it ships — with no backfill, and no member silently missing a row.
 */
export async function getNotificationPreferences(
  resolved: ResolvedActor,
): Promise<PreferenceView[]> {
  // Both layers in one transaction, for the reason slice 8 folded the
  // mentionable list into `getCommentThread` and slice 9 the unread count into
  // `resolveActorContext`: two questions about the same screen asked down two
  // round trips is a cost every render pays.
  const { saved, defaults } = await withActor(resolved.context, async (tx) => ({
    saved: await tx
      .select({
        kind: notificationPreference.kind,
        channels: notificationPreference.channels,
      })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.workspaceMemberId, resolved.memberId),
          isNull(notificationPreference.deletedAt),
        ),
      ),
    defaults: await readWorkspaceDefaults(tx),
  }));

  const byKind = new Map(saved.map((row) => [row.kind, row.channels]));
  const fallback = effectiveDefaults(defaults);

  return NOTIFICATION_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      available: CHANNELS[kind],
      // §6-6's three layers: this person's row, then the company's, then the
      // product's. `effectiveDefaults` folds the last two, so the screen shows
      // what a member with no row of their own actually gets — which is what
      // makes "default" an honest word on it.
      enabled: row ?? fallback[kind],
      customised: row !== undefined,
    };
  });
}

/* ------------------------------------------------------------------------- */
/* §6-6's other half: the company's defaults (slice 15)                      */
/* ------------------------------------------------------------------------- */

async function readWorkspaceDefaults(tx: TenantDb): Promise<PreferenceMap> {
  const rows = await tx
    .select({
      kind: workspaceNotificationDefault.kind,
      channels: workspaceNotificationDefault.channels,
    })
    .from(workspaceNotificationDefault)
    .where(isNull(workspaceNotificationDefault.deletedAt));

  return Object.fromEntries(rows.map((row) => [row.kind, row.channels])) as PreferenceMap;
}

export type WorkspaceDefaultView = {
  kind: NotificationKind;
  available: readonly NotificationChannel[];
  /** What a member with no row of their own gets — the company's, or the product's. */
  enabled: readonly NotificationChannel[];
  /** True when the company has overridden the product's default for this kind. */
  customised: boolean;
};

/**
 * The company's notification defaults (§6-6), for the settings screen.
 *
 * Deliberately the same shape as `PreferenceView`, so `PreferencesGrid` renders
 * both screens: they are the same grid asked about different rows, and two
 * components would be two places to get the digest's email-only rule wrong.
 */
export async function getWorkspaceNotificationDefaults(
  resolved: ResolvedActor,
): Promise<WorkspaceDefaultView[]> {
  const defaults = await withActor(resolved.context, readWorkspaceDefaults);

  return NOTIFICATION_KINDS.map((kind) => ({
    kind,
    available: CHANNELS[kind],
    enabled: defaults[kind] ?? DEFAULT_PREFERENCES[kind],
    customised: defaults[kind] !== undefined,
  }));
}

/**
 * Set one kind's company default.
 *
 * `workspace.settings`, unlike its per-member twin, which asks nothing: this
 * one changes what everybody who has never opened the screen receives, and §10's
 * row already covers it. It is also why this emits an event where
 * `setNotificationPreference` emits none — a company-wide delivery change is an
 * administrative act somebody may later have to explain (§18-11).
 */
export async function setWorkspaceNotificationDefault(
  resolved: ResolvedActor,
  input: { kind: string; channels: readonly string[] },
): Promise<Ok | Failed> {
  assertCan(resolved.actor, 'workspace.settings');

  if (!isNotificationKind(input.kind)) return { ok: false, problem: 'unknown_kind' };
  const kind = input.kind;

  const channels = [
    ...new Set(
      input.channels.filter(
        (channel): channel is NotificationChannel =>
          isNotificationChannel(channel) && CHANNELS[kind].includes(channel),
      ),
    ),
  ];

  return withActor(resolved.context, async (tx, uow) => {
    await tx
      .insert(workspaceNotificationDefault)
      .values({ workspaceId: resolved.workspace.id, kind, channels })
      .onConflictDoUpdate({
        target: [workspaceNotificationDefault.workspaceId, workspaceNotificationDefault.kind],
        set: { channels, updatedAt: new Date(), deletedAt: null },
      });

    uow.emit({
      type: 'workspace.notification_defaults_changed',
      workspaceId: resolved.workspace.id,
      kind,
      channels,
    });

    return { ok: true } as const;
  });
}

/**
 * Save one kind's channels.
 *
 * One kind per call rather than the whole screen at once, because the screen is
 * a grid of independent switches and §11's rule is that a refused mutation
 * reports in the row that caused it. A single save of everything would have to
 * report a failure about a checkbox somewhere in a form.
 *
 * Channels a kind cannot use are dropped rather than refused — `CHANNELS` is
 * the authority, and a client sending `in_app` for the digest is describing
 * something that does not exist rather than asking for something forbidden.
 */
export async function setNotificationPreference(
  resolved: ResolvedActor,
  input: { kind: string; channels: readonly string[] },
): Promise<Ok | Failed> {
  if (!isNotificationKind(input.kind)) return { ok: false, problem: 'unknown_kind' };
  const kind = input.kind;

  const channels = [
    ...new Set(
      input.channels.filter(
        (channel): channel is NotificationChannel =>
          isNotificationChannel(channel) && CHANNELS[kind].includes(channel),
      ),
    ),
  ];

  return withActor(resolved.context, async (tx) => {
    await tx
      .insert(notificationPreference)
      .values({
        workspaceId: resolved.workspace.id,
        workspaceMemberId: resolved.memberId,
        kind,
        channels,
      })
      /**
       * Upsert on the member/kind pair. A row exists only where somebody made a
       * choice, so this is the moment one starts existing — and turning a kind
       * fully off writes an empty array rather than deleting the row, because
       * an absent row means "the default", and the default is not off.
       */
      .onConflictDoUpdate({
        target: [notificationPreference.workspaceMemberId, notificationPreference.kind],
        set: { channels, updatedAt: new Date(), deletedAt: null },
      });

    return { ok: true } as const;
  });
}
