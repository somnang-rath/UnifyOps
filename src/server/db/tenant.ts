import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { activityRowsFor, auditRowFor } from '@/server/events/registry';
import type { DomainEvent } from '@/server/events/types';
import type { RawDb, TenantDb } from './client';
import { rawDb } from './client';
import { activity, auditRecord } from './schema';

/**
 * Who is acting, resolved once per request.
 *
 * `userId` and `actorUserId` are the same person in every ordinary request and
 * differ only during view-as (§7.13), where the context resolves to the target
 * member so that policy and RLS both answer "what does Sophea see?". Keeping
 * the real principal alongside it is what stops a view-as session from being
 * invisible in the audit log that exists to record it (§18-11).
 */
export const actorContextSchema = z.object({
  workspaceId: z.string().uuid(),
  /** The member whose scope applies — the view-as target while view-as is active. */
  userId: z.string().uuid(),
  /** The authenticated principal. Equals `userId` unless view-as is active. */
  actorUserId: z.string().uuid(),
  /** True while view-as is active. Every mutation is refused (§7.13). */
  readOnly: z.boolean().default(false),
});

export type ActorContext = z.infer<typeof actorContextSchema>;

/**
 * The transaction-local settings the RLS policies read.
 *
 * Transaction-local (`set_config(..., true)`) rather than session-local is not
 * a detail: a pooled connection with session-scoped tenancy would hand the
 * next request whatever the previous one set, and the leak would only appear
 * under concurrency.
 */
const SETTINGS = {
  workspaceId: 'unifyops.workspace_id',
  userId: 'unifyops.user_id',
  actorUserId: 'unifyops.actor_user_id',
  readOnly: 'unifyops.read_only',
} as const;

export class ReadOnlyActorError extends Error {
  constructor(what: string) {
    super(
      `${what} is a mutation, and this session is read-only (view-as is active). ` +
        'View-as re-resolves a real actor for the target member and refuses every mutation — §7.13.',
    );
    this.name = 'ReadOnlyActorError';
  }
}

/**
 * Collects the events a mutation produced, and flushes them before commit.
 *
 * Before commit, not after: an audit row that survives a rolled-back mutation
 * is a lie, and one written after commit can be lost between the two.
 */
export class UnitOfWork {
  readonly #events: DomainEvent[] = [];

  constructor(private readonly ctx: ActorContext) {}

  /** Record an event. Nothing is written until the flush, so ordering is preserved. */
  emit(event: DomainEvent): void {
    if (this.ctx.readOnly) throw new ReadOnlyActorError(`Emitting ${event.type}`);
    this.#events.push(event);
  }

  get events(): readonly DomainEvent[] {
    return this.#events;
  }

  /**
   * Called by `withActor` inside the transaction. Not public: a caller who can
   * flush by hand can flush twice.
   */
  async flush(tx: RawDb): Promise<void> {
    if (this.#events.length === 0) return;

    const rows = this.#events.flatMap((event) => {
      const draft = auditRowFor(event);
      if (!draft) return [];
      return [
        {
          workspaceId: this.ctx.workspaceId,
          actorKind: 'member' as const,
          actorUserId: this.ctx.actorUserId,
          // Null unless the principal is acting as someone else.
          onBehalfOfUserId:
            this.ctx.userId === this.ctx.actorUserId ? null : this.ctx.userId,
          action: draft.action,
          subjectType: draft.subjectType,
          subjectId: draft.subjectId,
          data: draft.data,
        },
      ];
    });

    if (rows.length > 0) await tx.insert(auditRecord).values(rows);

    /**
     * The second sink (§8, slice 7). Same events, same transaction, different
     * question: audit asks what a company's administrators need to reconstruct,
     * activity asks what happened to one work item.
     *
     * Ordered by the projectors, then inserted in one statement, so the ids —
     * UUIDv7, generated per row in this order — break the tie that `occurred_at`
     * leaves. Every row of one transaction shares a timestamp, because `now()`
     * is transaction start; without a tiebreak the feed would shuffle three
     * field changes into a different order on every read.
     *
     * Emitted while read-only, this would be a lie about who did something —
     * which is why `emit` refuses before any of it runs, and the table's INSERT
     * policy refuses again underneath.
     */
    const feed = this.#events.flatMap((event) =>
      activityRowsFor(event).map((draft) => ({
        workspaceId: this.ctx.workspaceId,
        projectId: draft.projectId,
        workItemId: draft.workItemId,
        actorUserId: this.ctx.actorUserId,
        action: draft.action,
        data: draft.data,
      })),
    );

    if (feed.length > 0) await tx.insert(activity).values(feed);

    // Slice 9 adds the transactional outbox pg-boss consumes here — a third
    // sink of the same shape, over these same events, inside this transaction.
    this.#events.length = 0;
  }
}

/**
 * Opens a tenant-scoped transaction and runs `fn` inside it.
 *
 * The only producer of a `TenantDb`. Everything that touches tenant data goes
 * through here, which is what lets the brand mean something.
 */
export async function withActor<T>(
  context: ActorContext,
  fn: (tx: TenantDb, uow: UnitOfWork) => Promise<T>,
  db: RawDb = rawDb(),
): Promise<T> {
  const ctx = actorContextSchema.parse(context);

  return db.transaction(async (tx) => {
    // Parameterised, and the ids are UUID-validated above — the settings are
    // read back through `::uuid` casts in tenancy.workspace_id() and friends,
    // so a malformed value would fail at query time, far from its cause.
    await tx.execute(sql`
      select
        set_config(${SETTINGS.workspaceId}, ${ctx.workspaceId}, true),
        set_config(${SETTINGS.userId}, ${ctx.userId}, true),
        set_config(${SETTINGS.actorUserId}, ${ctx.actorUserId}, true),
        set_config(${SETTINGS.readOnly}, ${ctx.readOnly ? 'on' : 'off'}, true)
    `);

    const scoped = tx as unknown as TenantDb;
    const uow = new UnitOfWork(ctx);

    const result = await fn(scoped, uow);

    await uow.flush(tx);

    return result;
  });
}
