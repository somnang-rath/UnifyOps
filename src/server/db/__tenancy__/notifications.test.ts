import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import {
  notification,
  notificationPreference,
  outboxMessage,
  workItem,
  workspace,
  workspaceHoliday,
} from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The outbox, the inbox, and the calendar behind the digest (§7.8, §8 — slice 9).
 *
 * `registry.test.ts` proves the notify projectors decide the right things in
 * JavaScript. This proves the halves only a real Postgres can:
 *
 *   * that an outbox row is written **inside the mutation's own transaction**,
 *     which is the entire justification for the table existing;
 *   * that `flush` translates members to users and drops the actor, so §7.8's
 *     "an actor never hears about their own action" holds at the one place it
 *     is implemented;
 *   * that all four new tables are scoped to one workspace and that the outbox
 *     cannot be deleted from a request;
 *   * and that `is_working_day` / `next_working_day` / `business_days_between`
 *     agree with the mask and the holiday table — the three functions §9 puts
 *     the digest, staleness and cycle progress behind so they cannot disagree.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'notify-a');
  b = await seedWorkspace(h, 'notify-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actorFor = (w: SeededWorkspace, readOnly = false) => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly,
});

async function makeItem(w: SeededWorkspace): Promise<string> {
  const id = uuidv7();

  await withActor(
    actorFor(w),
    async (tx) => {
      await tx.insert(workItem).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        number: Math.floor(Math.random() * 1_000_000),
        title: 'A task',
        stateId: w.stateId,
        rootId: id,
        rank: 'i',
        createdByMemberId: w.ownerMemberId,
      });
    },
    h.app,
  );

  return id;
}

/** Read back as the operator, so a scoping bug cannot hide behind the reader. */
const outboxFor = (workItemId: string) =>
  h.operator.select().from(outboxMessage).where(eq(outboxMessage.workItemId, workItemId));

describe('the transactional outbox', () => {
  it('writes a row in the same transaction as the change that caused it', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'comment.created',
          workspaceId: a.workspaceId,
          subject: { kind: 'work_item', projectId: a.projectId, workItemId: itemId },
          commentId: uuidv7(),
          mentioned: [a.memberMemberId],
          subscriberIds: [],
        });
      },
      h.app,
    );

    const rows = await outboxFor(itemId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('mention');
    expect(rows[0]?.eventType).toBe('comment.created');
    expect(rows[0]?.deliveredAt).toBeNull();
  });

  it('rolls the outbox row back with the mutation that failed', async () => {
    const itemId = await makeItem(a);

    await expect(
      withActor(
        actorFor(a),
        async (_tx, uow) => {
          uow.emit({
            type: 'comment.created',
            workspaceId: a.workspaceId,
            subject: { kind: 'work_item', projectId: a.projectId, workItemId: itemId },
            commentId: uuidv7(),
            mentioned: [a.memberMemberId],
            subscriberIds: [],
          });

          throw new Error('the mutation failed after emitting');
        },
        h.app,
      ),
    ).rejects.toThrow('the mutation failed after emitting');

    // The whole point of the pattern: no notification about something that
    // never happened, and no email to un-send.
    expect(await outboxFor(itemId)).toHaveLength(0);
  });

  it('resolves member ids to user ids', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.state_changed',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          from: a.stateId,
          to: a.stateId,
          completed: false,
          assigneeIds: [a.memberMemberId],
        });
      },
      h.app,
    );

    const rows = await outboxFor(itemId);

    expect(rows[0]?.recipientUserIds).toEqual([a.memberUserId]);
  });

  it('never notifies the actor about their own action (§7.8)', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.state_changed',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          from: a.stateId,
          to: a.stateId,
          completed: false,
          // The owner is acting and is also assigned; the other member is not.
          assigneeIds: [a.ownerMemberId, a.memberMemberId],
        });
      },
      h.app,
    );

    const rows = await outboxFor(itemId);

    expect(rows[0]?.recipientUserIds).toEqual([a.memberUserId]);
  });

  it('writes nothing when the only person concerned is the actor', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.updated',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          fields: ['title'],
          assigneeIds: [a.ownerMemberId],
        });
      },
      h.app,
    );

    expect(await outboxFor(itemId)).toHaveLength(0);
  });

  it('gives every row a monotonic seq, for the §8 replay seam', async () => {
    const itemId = await makeItem(a);

    for (const field of ['title', 'dueDate']) {
      await withActor(
        actorFor(a),
        async (_tx, uow) => {
          uow.emit({
            type: 'work_item.updated',
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: itemId,
            fields: [field],
            assigneeIds: [a.memberMemberId],
          });
        },
        h.app,
      );
    }

    const rows = await h.operator
      .select()
      .from(outboxMessage)
      .where(eq(outboxMessage.workItemId, itemId))
      .orderBy(outboxMessage.seq);

    expect(rows).toHaveLength(2);
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq);
  });

  it('emits nothing at all from a view-as session', async () => {
    const itemId = await makeItem(a);

    // `uow.emit` refuses first (§7.13). The outbox never gets the chance, which
    // is the layer above the INSERT policy that would also refuse.
    await expect(
      withActor(
        actorFor(a, true),
        async (_tx, uow) => {
          uow.emit({
            type: 'work_item.updated',
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: itemId,
            fields: ['title'],
            assigneeIds: [a.memberMemberId],
          });
        },
        h.app,
      ),
    ).rejects.toThrow(/read-only/i);

    expect(await outboxFor(itemId)).toHaveLength(0);
  });

  it('is scoped to one workspace and cannot be deleted from a request', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.updated',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          fields: ['title'],
          assigneeIds: [a.memberMemberId],
        });
      },
      h.app,
    );

    // Workspace B sees none of it, even asking for every row in the table.
    const acrossTheBoundary = await withActor(
      actorFor(b),
      async (tx) => tx.select().from(outboxMessage),
      h.app,
    );
    expect(acrossTheBoundary).toHaveLength(0);

    // And the workspace that wrote it cannot delete it: the privilege is
    // revoked in 0016 as well as the policy being absent.
    const failure = await failureOf(
      withActor(actorFor(a), async (tx) => tx.delete(outboxMessage), h.app),
    );
    expect(failure?.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('the inbox', () => {
  async function writeNotification(w: SeededWorkspace, outboxMessageId: string | null) {
    const itemId = await makeItem(w);

    return withActor(
      actorFor(w),
      async (tx) => {
        const [row] = await tx
          .insert(notification)
          .values({
            workspaceId: w.workspaceId,
            recipientMemberId: w.memberMemberId,
            kind: 'mention',
            eventType: 'comment.created',
            workItemId: itemId,
            outboxMessageId,
          })
          .returning({ id: notification.id });

        return row!.id;
      },
      h.app,
    );
  }

  it('returns nothing across a workspace boundary', async () => {
    await writeNotification(a, null);

    const rows = await withActor(actorFor(b), async (tx) => tx.select().from(notification), h.app);

    expect(rows).toHaveLength(0);
  });

  it('takes an update, unlike activity — its owner marks it read', async () => {
    const id = await writeNotification(a, null);

    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.update(notification).set({ readAt: new Date() }).where(eq(notification.id, id));
      },
      h.app,
    );

    const [row] = await h.operator.select().from(notification).where(eq(notification.id, id));
    expect(row?.readAt).not.toBeNull();
  });

  it('refuses a second row for the same recipient and message', async () => {
    // The constraint that makes the consumer idempotent: pg-boss delivers at
    // least once, and a retry must not put a second line in somebody's inbox.
    const itemId = await makeItem(a);

    const outboxId = await withActor(
      actorFor(a),
      async (tx) => {
        const [row] = await tx
          .insert(outboxMessage)
          .values({
            workspaceId: a.workspaceId,
            eventType: 'comment.created',
            payload: {},
            kind: 'mention',
            workItemId: itemId,
            recipientUserIds: [a.memberUserId],
          })
          .returning({ id: outboxMessage.id });

        return row!.id;
      },
      h.app,
    );

    const insertOnce = () =>
      withActor(
        actorFor(a),
        async (tx) => {
          await tx.insert(notification).values({
            workspaceId: a.workspaceId,
            recipientMemberId: a.memberMemberId,
            kind: 'mention',
            eventType: 'comment.created',
            workItemId: itemId,
            outboxMessageId: outboxId,
          });
        },
        h.app,
      );

    await insertOnce();
    const failure = await failureOf(insertOnce());

    expect(failure?.code).toBe(SQLSTATE.uniqueViolation);
  });

  it('scopes preferences to the workspace that saved them', async () => {
    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(notificationPreference).values({
          workspaceId: a.workspaceId,
          workspaceMemberId: a.ownerMemberId,
          kind: 'mention',
          channels: ['in_app'],
        });
      },
      h.app,
    );

    const rows = await withActor(
      actorFor(b),
      async (tx) => tx.select().from(notificationPreference),
      h.app,
    );

    expect(rows).toHaveLength(0);
  });
});

/**
 * §9: "Staleness, the reminder digest, and cycle progress all call it — three
 * surfaces that must never disagree about whether Friday counted." Slice 9 is
 * the first caller; these tests are what the other two will inherit.
 *
 * 2026-09-07 is a Monday, so the week below runs Mon–Sun.
 */
describe('working days and holidays', () => {
  const MONDAY = '2026-09-07';
  const SATURDAY = '2026-09-12';
  const SUNDAY = '2026-09-13';

  const ask = async <T>(query: ReturnType<typeof sql<T>>): Promise<T> => {
    const result = await h.operator.execute(sql`select ${query} as answer`);
    return (result.rows[0] as { answer: T }).answer;
  };

  const isWorkingDay = (w: SeededWorkspace, date: string) =>
    ask<boolean>(sql`is_working_day(${w.workspaceId}::uuid, ${date}::date)`);

  const nextWorkingDay = (w: SeededWorkspace, date: string) =>
    ask<string | null>(sql`next_working_day(${w.workspaceId}::uuid, ${date}::date)`);

  const businessDays = (w: SeededWorkspace, from: string, to: string) =>
    ask<number>(sql`business_days_between(${w.workspaceId}::uuid, ${from}::date, ${to}::date)`);

  it('defaults to a six-day week, which is the market §2.5 describes', async () => {
    // 63 = 0b0111111, Monday through Saturday. A Monday–Friday default would be
    // a European assumption written into a Cambodian product.
    expect(await isWorkingDay(a, MONDAY)).toBe(true);
    expect(await isWorkingDay(a, SATURDAY)).toBe(true);
    expect(await isWorkingDay(a, SUNDAY)).toBe(false);
  });

  it('respects a company that works a five-day week', async () => {
    await h.owner
      .update(workspace)
      // 31 = 0b0011111, Monday through Friday.
      .set({ workingDays: 31 })
      .where(eq(workspace.id, b.workspaceId));

    expect(await isWorkingDay(b, SATURDAY)).toBe(false);
    expect(await isWorkingDay(b, MONDAY)).toBe(true);
  });

  it('closes on a holiday even when the weekday mask says otherwise (§17-18)', async () => {
    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(workspaceHoliday).values({
          workspaceId: a.workspaceId,
          date: MONDAY,
          name: 'ចូលឆ្នាំខ្មែរ',
        });
      },
      h.app,
    );

    expect(await isWorkingDay(a, MONDAY)).toBe(false);
  });

  it('finds the next working day across a weekend', async () => {
    // Friday, for the five-day company: the next working day is Monday, which
    // is what makes Friday evening's digest carry Monday's work (§7.8).
    expect(await nextWorkingDay(b, '2026-09-11')).toBe('2026-09-14');
  });

  it('skips a holiday when looking forward', async () => {
    // From the Sunday *before* the holiday: Monday is closed for Khmer New
    // Year, so the next working day is the Tuesday. This is the §17-18 case —
    // a multi-day lunar-dated closure that a weekday mask alone cannot see.
    expect(await nextWorkingDay(a, '2026-09-06')).toBe('2026-09-08');
  });

  it('counts a half-open range, so the due date itself is not a day late', async () => {
    // Mon→Tue is one working day; the same day is zero. `business_days_between`
    // reading 1 on the due date is how an item becomes "a day overdue" the
    // moment it is due.
    expect(await businessDays(b, '2026-09-08', '2026-09-08')).toBe(0);
    expect(await businessDays(b, '2026-09-08', '2026-09-09')).toBe(1);
  });

  it('does not count the weekend it spans', async () => {
    // Friday → Tuesday is two working days for the five-day company, not four.
    expect(await businessDays(b, '2026-09-11', '2026-09-15')).toBe(2);
  });

  it('goes negative when the range runs backwards', async () => {
    expect(await businessDays(b, '2026-09-09', '2026-09-08')).toBe(-1);
  });

  it('answers per workspace, never across', async () => {
    // The same Saturday: a works it, b does not. One function, two calendars.
    expect(await isWorkingDay(a, SATURDAY)).toBe(true);
    expect(await isWorkingDay(b, SATURDAY)).toBe(false);
  });
});
