import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { appUrl } from '@/env';
import { wants } from '@/lib/notification-kinds';
import type { NotificationChannel, NotificationKind } from '@/lib/notification-kinds';
import type { TenantDb } from '@/server/db/client';
import { inSequence } from '@/server/db/sequence';
import { withActor } from '@/server/db/tenant';
import {
  notification,
  notificationPreference,
  workspaceNotificationDefault,
  outboxMessage,
  project,
  user,
  wikiPage,
  wikiSpace,
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

  const context = await loadContext(message.workspaceId, message.id);
  if (!context) {
    /**
     * Nothing to say, and nothing more to try (§21.6).
     *
     * The message is marked delivered rather than left alone, which is the half
     * of this that slice 18 got wrong: a bare `return` leaves the row undelivered
     * and `drainOutbox` re-enqueues it on the next sweep, five seconds later,
     * indefinitely. That is a stuck row rather than a lost notification — worse,
     * because it occupies one of the drain's slots for ever and is invisible
     * unless somebody reads the outbox by hand.
     *
     * A context that will not resolve resolves no better on the tenth attempt:
     * the subject was deleted, or is of a kind this build does not know. Both are
     * terminal, and `delivery_error` records which message it was.
     */
    await markDelivered(
      message.workspaceId,
      message.id,
      'no subject: the item or page it names is gone',
      message.recipientUserIds,
    );
    return;
  }

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
          wikiPageId: message.wikiPageId,
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

/**
 * What a notification is about, as the worker needs it (§20.6, §21.6).
 *
 * `queries/notifications.ts` reconstructs the same union for the inbox and this
 * reconstructs it for the email, from the same two nullable columns. Two
 * reconstructions rather than one shared helper, because they read from
 * different connections in different scopes — the inbox reads as the recipient
 * under RLS, and this reads on the platform connection for the whole message at
 * once — and folding them together would mean one of the two lying about which
 * scope it ran in.
 *
 * `key` is what the subject line names: `ENG-142` for an item, the page's own
 * title for a page — because a page has no short identifier and its title is the
 * thing a reader recognises. `title` is the line under the heading, which is the
 * item's title or the space the page lives in.
 */
type MessageSubject =
  | { kind: 'work_item'; key: string; title: string; projectSlug: string; number: number }
  | { kind: 'wiki_page'; key: string; title: string; spaceSlug: string; pageSlug: string };

type MessageContext = {
  workspaceName: string;
  workspaceSlug: string;
  actorName: string;
  subject: MessageSubject;
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
): Promise<MessageContext | null> {
  /**
   * **Both joins are `left`, and slice 21 is where that stopped being cosmetic.**
   *
   * This was an `innerJoin` on `work_item` with a comment beside it reading
   * "every notifying event is about a work item". §20.6 made that false one slice
   * earlier: a mention in a page body writes an outbox row whose `work_item_id`
   * is null, the inner join then matched nothing, this function returned null,
   * and `deliverNotification` returned **without marking the message delivered**
   * — so the row stayed at the head of `drainOutbox`'s partial index and was
   * re-enqueued every five seconds, for ever, while nobody's inbox ever showed it.
   *
   * The inbox query had already been converted to left joins for exactly this
   * reason and says so in its own comment; the worker was missed. It is the third
   * time in this repo that a subject union has had to be chased through a join
   * (§20.6's `notification` inner join, slice 18's `SEARCH_SECTIONS` payload,
   * this), and the pattern is worth stating: **widening a union is not done until
   * every reader of the narrow field has been visited**, and the compiler cannot
   * find them because a nullable column type-checks either way.
   */
  const [row] = await platformDb()
    .select({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      actorName: sql<string | null>`actor.name`,
      itemTitle: workItem.title,
      itemNumber: workItem.number,
      projectKey: project.key,
      projectSlug: project.slug,
      pageTitle: wikiPage.title,
      pageSlug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
      spaceName: wikiSpace.name,
    })
    .from(outboxMessage)
    .innerJoin(workspace, eq(workspace.id, outboxMessage.workspaceId))
    .leftJoin(sql`app_user as actor`, sql`actor.id = ${outboxMessage.actorUserId}`)
    .leftJoin(workItem, eq(workItem.id, outboxMessage.workItemId))
    .leftJoin(project, eq(project.id, workItem.projectId))
    .leftJoin(wikiPage, eq(wikiPage.id, outboxMessage.wikiPageId))
    .leftJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(eq(outboxMessage.id, outboxMessageId))
    .limit(1);

  if (!row) return null;

  const subject = subjectOf(row);
  // A subject whose parent went away between the mutation and this read. Not an
  // error: the message is marked delivered by the caller either way, because a
  // notification about a deleted item is a notification nobody wants and one
  // that can never succeed.
  if (subject === null) return null;

  return {
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    // A deleted account still caused the event. §7.12 keeps history attributed,
    // and an email that says "Someone mentioned you" is better than none.
    actorName: row.actorName ?? '',
    subject,
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
    wikiPageId: string | null;
    commentId: string | null;
    actorUserId: string | null;
  };
  context: MessageContext;
}): Promise<void> {
  const { message, context } = input;

  /**
   * The narrowing that used to be a silent drop (§20.6, §21.6).
   *
   * This read `if (message.workItemId === null) return;` — correct while every
   * notifying draft was about an item, and a silent discard of every page
   * notification from the moment §20.6 made that untrue. `loadContext` above has
   * already resolved which subject this is against the *rows*, so the columns
   * are taken from it rather than re-tested here: one place decides, and the
   * insert below follows.
   */
  const subjectColumns =
    context.subject.kind === 'work_item'
      ? { workItemId: message.workItemId, wikiPageId: null }
      : { workItemId: null, wikiPageId: message.wikiPageId };

  // `loadContext` resolved a subject, so the matching column is set. Refused
  // rather than asserted, for `claimPending`'s reason: a `!` would keep compiling
  // if either constraint were relaxed, and a notification row with no subject
  // fails `notification_one_subject` in a background worker.
  if (subjectColumns.workItemId === null && subjectColumns.wikiPageId === null) return;

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
            ...subjectColumns,
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
    subjectKind: context.subject.kind,
    subjectKey: context.subject.key,
    subjectTitle: context.subject.title,
    workspaceName: context.workspaceName,
    url: subjectUrl({
      locale: outcome.recipient.locale,
      workspaceSlug: context.workspaceSlug,
      subject: context.subject,
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
 * Both rows are read on the caller's transaction, which is one client and so
 * one query at a time (see `inSequence`) — this was written as a `Promise.all`
 * on the belief that the two went out together, and they never did. It runs once
 * per recipient per message, so if the second lookup ever shows up in the
 * worker's profile the fix is one `union all` over the two tables rather than a
 * concurrency the connection cannot give.
 */
export async function channelsFor(
  tx: TenantDb,
  memberId: string,
  kind: NotificationKind,
): Promise<NotificationChannel[]> {
  const [[row], [fallback]] = await inSequence(
    () =>
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
    () =>
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
  );

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
 * The two nullable column pairs, resolved into one subject (§20.6, §21.6).
 *
 * Returns null when neither branch resolves — the item or page was deleted
 * between the mutation and this read, which is ordinary rather than an error and
 * is what the caller turns into a delivered-with-a-reason.
 *
 * A page's `key` is its **title**, because a page has no `ENG-142` and its title
 * is what a reader recognises in a subject line. Its `title` is the space, so the
 * line under the heading answers "which handbook is this" — the same job an
 * item's title does for its key.
 */
function subjectOf(row: {
  itemTitle: string | null;
  itemNumber: number | null;
  projectKey: string | null;
  projectSlug: string | null;
  pageTitle: string | null;
  pageSlug: string | null;
  spaceSlug: string | null;
  spaceName: string | null;
}): MessageSubject | null {
  if (
    row.itemTitle !== null &&
    row.itemNumber !== null &&
    row.projectKey !== null &&
    row.projectSlug !== null
  ) {
    return {
      kind: 'work_item',
      key: `${row.projectKey}-${row.itemNumber}`,
      title: row.itemTitle,
      projectSlug: row.projectSlug,
      number: row.itemNumber,
    };
  }

  if (row.pageTitle !== null && row.pageSlug !== null && row.spaceSlug !== null) {
    return {
      kind: 'wiki_page',
      key: row.pageTitle,
      title: row.spaceName ?? '',
      spaceSlug: row.spaceSlug,
      pageSlug: row.pageSlug,
    };
  }

  return null;
}

/**
 * The deep link §7.8 asks for: the subject, and the specific comment when there
 * is one.
 *
 * Locale-prefixed, because `localePrefix: 'always'` — a link without one is a
 * redirect at best and the wrong language at worst (§13). Built here rather
 * than with `@/i18n/navigation`, whose helpers are for a request that has a
 * locale in context; a worker has a row in a database and a person's saved
 * preference.
 *
 * A `switch` on the union rather than an `if` on a nullable field, so a third
 * subject is a compile error here rather than a link that silently goes nowhere
 * — the construction `subjectHref` uses in the inbox, for the same reason.
 *
 * **The comment anchor is appended on both branches** since §21.6 gave pages a
 * thread. Dropping 0032's `notification_comment_with_item` CHECK is the database
 * half of the same sentence; see 0038.
 */
export function subjectUrl(input: {
  locale: string;
  workspaceSlug: string;
  subject: MessageSubject;
  commentId: string | null;
}): string {
  const base = appUrl().replace(/\/+$/, '');
  const prefix = `${base}/${input.locale}/${input.workspaceSlug}`;

  const path =
    input.subject.kind === 'work_item'
      ? `${prefix}/projects/${input.subject.projectSlug}/${input.subject.number}`
      : `${prefix}/wiki/${input.subject.spaceSlug}/${input.subject.pageSlug}`;

  return input.commentId ? `${path}#comment-${input.commentId}` : path;
}

