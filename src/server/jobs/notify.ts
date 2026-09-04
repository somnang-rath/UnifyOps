import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { appUrl } from '@/env';
import { wants } from '@/lib/notification-kinds';
import type { NotificationChannel, NotificationKind } from '@/lib/notification-kinds';
import type { TenantDb } from '@/server/db/client';
import { withActor } from '@/server/db/tenant';
import {
  notification,
  notificationPreference,
  workspaceNotificationDefault,
  outboxMessage,
  project,
  user,
  workItem,
  workspace,
  workspaceMember,
} from '@/server/db/schema';
import { sendMail } from '@/server/email/mailer';
import { notificationEmail } from '@/server/email/templates';
import { platformDb } from './client';

/**
 * Turning outbox rows into inboxes and email (§7.8, §8).
 *
 * The consumer half of the transactional outbox. A mutation wrote the row
 * inside its own transaction and returned; nothing about delivery is on the
 * request's critical path, which is the point — a workspace where forty people
 * watch an item should not make the person who edited its title wait for forty
 * inserts and forty SMTP round trips.
 *
 * **Delivery is at-least-once and made idempotent by the schema.** pg-boss can
 * hand the same job to a second worker after a timeout, and a partial failure
 * (three notifications written, the fourth email refused) is retried whole. The
 * unique key on `(outbox_message_id, recipient_member_id)` turns the re-insert
 * into a no-op, so what a retry actually retries is the part that failed.
 *
 * The one thing that is *not* exactly-once is email: a retry after a send that
 * succeeded but whose row never committed sends a second copy. That is the
 * right way round — a duplicated mention email is a mild annoyance, a missing
 * one is somebody never learning they were asked a question.
 */

export const NOTIFY_QUEUE = 'notification.deliver';

export type NotifyJob = { workspaceId: string; outboxMessageId: string };

/**
 * How many undelivered rows one sweep will enqueue.
 *
 * A ceiling rather than a page: the sweep runs again in seconds, so a backlog
 * drains over several passes instead of building one enormous batch after an
 * outage. Ordered by `seq`, so it drains oldest-first and nobody's mention
 * waits behind a newer one.
 */
const DRAIN_LIMIT = 500;

/**
 * Find outbox rows nobody has delivered yet and enqueue one job each.
 *
 * Reads on the platform connection (§18-12), because "which rows are
 * undelivered" spans workspaces and no tenant scope can answer it. That
 * connection is `SELECT`-only at the role level, so this function could not
 * write even if it tried — the marking happens later, per message, on the app
 * connection inside a real member's scope.
 *
 * The sweep is the whole discovery mechanism, deliberately. A mutation could
 * enqueue its own job after committing, and it would shave a few seconds off —
 * but then the queue would be part of the request path, the web process would
 * hold a queue client, and a send that failed between commit and enqueue would
 * leave a row nothing ever looks at again. Polling one partial index is cheap,
 * and it is self-healing by construction: whatever is undelivered gets picked
 * up next time, whatever the reason it was missed.
 */
export async function drainOutbox(boss: PgBoss): Promise<number> {
  const rows = await platformDb()
    .select({ id: outboxMessage.id, workspaceId: outboxMessage.workspaceId })
    .from(outboxMessage)
    .where(isNull(outboxMessage.deliveredAt))
    .orderBy(asc(outboxMessage.seq))
    .limit(DRAIN_LIMIT);

  for (const row of rows) {
    /**
     * The outbox row's own id is the singleton key, so a sweep that runs while
     * the previous job for the same row is still queued does not enqueue it
     * twice. Belt to the unique constraint's braces: this keeps the queue tidy,
     * the constraint keeps the inbox correct.
     */
    await boss.send(
      NOTIFY_QUEUE,
      { workspaceId: row.workspaceId, outboxMessageId: row.id } satisfies NotifyJob,
      { singletonKey: row.id },
    );
  }

  return rows.length;
}

type Recipient = {
  memberId: string;
  userId: string;
  email: string;
  name: string;
  locale: string;
};

/**
 * Deliver one outbox message to everyone it names.
 *
 * Each recipient is handled in **their own** `withActor` transaction, which is
 * not incidental. It means the notification row is written by the app role
 * under RLS in the workspace it belongs to, exactly as a request would write
 * it — the worker has no privileged path, and a bug here fails closed rather
 * than writing into the wrong company.
 *
 * One recipient failing does not take the others down: the loop records the
 * failure and carries on, and the message is only marked delivered when every
 * recipient has been dealt with. That is §7.10's rule for bulk invitations
 * applied to the same shape of problem — "part of a batch fails → no rollback".
 */
export async function deliverNotification(job: NotifyJob): Promise<void> {
  const [message] = await platformDb()
    .select()
    .from(outboxMessage)
    .where(eq(outboxMessage.id, job.outboxMessageId))
    .limit(1);

  // Gone, or already done. Both are ordinary: a retry of a completed job, or a
  // workspace deleted between the sweep and the handler.
  if (!message || message.deliveredAt !== null) return;
  if (message.recipientUserIds.length === 0) {
    await markDelivered(message.workspaceId, message.id, null, message.recipientUserIds);
    return;
  }

  const context = await loadContext(message.workspaceId, message.id, message.workItemId);
  if (!context) return;

  const failures: string[] = [];

  for (const userId of message.recipientUserIds) {
    try {
      await deliverToOne({
        userId,
        message: {
          id: message.id,
          workspaceId: message.workspaceId,
          kind: message.kind,
          eventType: message.eventType,
          workItemId: message.workItemId,
          commentId: message.commentId,
          actorUserId: message.actorUserId,
        },
        context,
      });
    } catch (error) {
      // Byte budget for a log column, not text anybody reads. The same
      // distinction `mailer.ts` draws for a provider's error: §13's
      // grapheme-aware truncation is for user-visible strings, and applying
      // `Intl.Segmenter` to a stack-trace fragment would be the wrong tool on
      // the wrong kind of text.
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${userId}: ${detail}`.slice(0, 200));
    }
  }

  // Same budget, same reasoning: `delivery_error` is a column an operator
  // greps, not a sentence a member is shown.
  const errorText = failures.length > 0 ? failures.join('; ').slice(0, 500) : null;

  await markDelivered(message.workspaceId, message.id, errorText, message.recipientUserIds);

  // Surfaced to pg-boss so the job retries with its own backoff. The rows that
  // did land are already written and the unique key will skip them, so a retry
  // costs only the recipients that failed.
  if (failures.length > 0) {
    throw new Error(`notification ${message.id}: ${failures.length} recipient(s) failed`);
  }
}

type MessageContext = {
  workspaceName: string;
  workspaceSlug: string;
  actorName: string;
  itemKey: string;
  itemTitle: string;
  itemNumber: number;
  projectSlug: string;
};

/**
 * The names and identifiers an email needs, read once for the whole message
 * rather than once per recipient.
 *
 * Read in one member's scope — the first recipient's — because RLS needs *a*
 * scope and every recipient of one message is in the same workspace. What is
 * read here is the item's own header and the actor's name, which every
 * recipient can already see: they are on the item or were named in it, and both
 * of those were checked when the event was produced.
 */
async function loadContext(
  workspaceId: string,
  outboxMessageId: string,
  workItemId: string | null,
): Promise<MessageContext | null> {
  const [row] = await platformDb()
    .select({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      actorName: sql<string | null>`actor.name`,
      itemTitle: workItem.title,
      itemNumber: workItem.number,
      projectKey: project.key,
      projectSlug: project.slug,
    })
    .from(outboxMessage)
    .innerJoin(workspace, eq(workspace.id, outboxMessage.workspaceId))
    .leftJoin(sql`app_user as actor`, sql`actor.id = ${outboxMessage.actorUserId}`)
    .innerJoin(workItem, eq(workItem.id, outboxMessage.workItemId))
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(eq(outboxMessage.id, outboxMessageId))
    .limit(1);

  if (!row || workItemId === null) return null;

  return {
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    // A deleted account still caused the event. §7.12 keeps history attributed,
    // and an email that says "Someone mentioned you" is better than none.
    actorName: row.actorName ?? '',
    itemKey: `${row.projectKey}-${row.itemNumber}`,
    itemTitle: row.itemTitle,
    itemNumber: row.itemNumber,
    projectSlug: row.projectSlug,
  };
}

async function deliverToOne(input: {
  userId: string;
  message: {
    id: string;
    workspaceId: string;
    kind: NotificationKind;
    eventType: string;
    workItemId: string | null;
    commentId: string | null;
    actorUserId: string | null;
  };
  context: MessageContext;
}): Promise<void> {
  const { message, context } = input;

  // Every notifying event is about a work item — the registry's `notify` drafts
  // all carry one — so this is a type narrowing rather than a real branch. The
  // column is nullable on `outbox_message` because the outbox is the general
  // seam §8 describes and a later event may not be item-shaped.
  const workItemId = message.workItemId;
  if (workItemId === null) return;

  const outcome = await withActor(
    {
      workspaceId: message.workspaceId,
      userId: input.userId,
      actorUserId: input.userId,
      readOnly: false,
    },
    async (tx) => {
      const recipient = await loadRecipient(tx, input.userId);
      // Offboarded between the mutation and now. §7.12 soft-deletes the
      // membership, so this is a real state and not an error.
      if (!recipient) return null;

      const channels = await channelsFor(tx, recipient.memberId, message.kind);

      if (channels.includes('in_app')) {
        await tx
          .insert(notification)
          .values({
            workspaceId: message.workspaceId,
            recipientMemberId: recipient.memberId,
            kind: message.kind,
            eventType: message.eventType,
            actorUserId: message.actorUserId,
            workItemId,
            commentId: message.commentId,
            outboxMessageId: message.id,
            data: {},
          })
          // The retry path. See the note at the top of this file: at-least-once
          // delivery plus a unique key is how "deliver again" stops meaning
          // "duplicate in somebody's inbox".
          .onConflictDoNothing({
            target: [notification.outboxMessageId, notification.recipientMemberId],
          });
      }

      return { recipient, email: channels.includes('email') };
    },
  );

  if (!outcome || !outcome.email) return;

  // Outside the transaction, exactly as §7.10's invitations are: a network call
  // inside one holds a pooled connection open for the length of somebody else's
  // outage.
  const mail = notificationEmail({
    locale: outcome.recipient.locale,
    kind: message.kind === 'digest' ? 'item_activity' : message.kind,
    actorName: context.actorName,
    itemKey: context.itemKey,
    itemTitle: context.itemTitle,
    workspaceName: context.workspaceName,
    url: itemUrl({
      locale: outcome.recipient.locale,
      workspaceSlug: context.workspaceSlug,
      projectSlug: context.projectSlug,
      number: context.itemNumber,
      commentId: message.commentId,
    }),
  });

  const result = await sendMail({ ...mail, to: outcome.recipient.email });
  if (!result.ok) throw new Error(result.error);
}

async function loadRecipient(tx: TenantDb, userId: string): Promise<Recipient | null> {
  const [row] = await tx
    .select({
      memberId: workspaceMember.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.userId, userId), isNull(workspaceMember.deletedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * Which channels this person wants for this kind.
 *
 * §6-6's three layers, resolved by `wants` in `src/lib/notification-kinds.ts`:
 * **this member's own row, then the company's default, then the product's.** An
 * absent row means the layer below at both levels, never "off" — almost nobody
 * opens the preference screen, and a product whose notifications are opt-in is a
 * product with no notifications.
 *
 * Both rows are read in one round trip, not two, because this runs once per
 * recipient per message: a workspace of forty people on one item is forty
 * lookups either way, and eighty is twice a cost the worker pays on the hot
 * path of every mention.
 */
export async function channelsFor(
  tx: TenantDb,
  memberId: string,
  kind: NotificationKind,
): Promise<NotificationChannel[]> {
  const [[row], [fallback]] = await Promise.all([
    tx
      .select({ channels: notificationPreference.channels })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.workspaceMemberId, memberId),
          eq(notificationPreference.kind, kind),
          isNull(notificationPreference.deletedAt),
        ),
      )
      .limit(1),
    tx
      .select({ channels: workspaceNotificationDefault.channels })
      .from(workspaceNotificationDefault)
      .where(
        and(
          eq(workspaceNotificationDefault.kind, kind),
          isNull(workspaceNotificationDefault.deletedAt),
        ),
      )
      .limit(1),
  ]);

  const saved = row ? { [kind]: row.channels } : {};
  const companyDefaults = fallback ? { [kind]: fallback.channels } : {};

  return (['in_app', 'email'] as const).filter((channel) =>
    wants(saved, kind, channel, companyDefaults),
  );
}

/**
 * Stamp the row, in the scope of somebody it was addressed to.
 *
 * The marking is a tenant write like any other, so it needs an actor — and any
 * recipient's scope is the right one, because the outbox row is in their
 * workspace and the UPDATE policy is keyed on the workspace alone. The first
 * recipient is chosen for no reason beyond being first; if their membership has
 * since gone, the next one is tried, and a message addressed to nobody who is
 * still here is left undelivered for a human to find.
 */
async function markDelivered(
  workspaceId: string,
  outboxMessageId: string,
  error: string | null,
  recipientUserIds: readonly string[],
): Promise<void> {
  for (const userId of recipientUserIds.length > 0 ? recipientUserIds : []) {
    try {
      await withActor({ workspaceId, userId, actorUserId: userId, readOnly: false }, async (tx) => {
        await tx
          .update(outboxMessage)
          .set({ deliveredAt: new Date(), deliveryError: error })
          .where(eq(outboxMessage.id, outboxMessageId));
      });
      return;
    } catch {
      // Try the next recipient's scope.
    }
  }
}

/**
 * The deep link §7.8 asks for: the item, and the specific comment when there is
 * one.
 *
 * Locale-prefixed, because `localePrefix: 'always'` — a link without one is a
 * redirect at best and the wrong language at worst (§13). Built here rather
 * than with `@/i18n/navigation`, whose helpers are for a request that has a
 * locale in context; a worker has a row in a database and a person's saved
 * preference.
 */
export function itemUrl(input: {
  locale: string;
  workspaceSlug: string;
  projectSlug: string;
  number: number;
  commentId: string | null;
}): string {
  const base = appUrl().replace(/\/+$/, '');
  const path = `${base}/${input.locale}/${input.workspaceSlug}/projects/${input.projectSlug}/${input.number}`;
  return input.commentId ? `${path}#comment-${input.commentId}` : path;
}

