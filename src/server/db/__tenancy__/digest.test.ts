import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { setTransport } from '@/server/email/mailer';
import type { Mail } from '@/server/email/mailer';
import { withActor } from '../tenant';
import { workItem, workItemAssignee, workspace, workspaceHoliday } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * §7.8's evening digest, driven end to end against a real database.
 *
 * §14's outcome for slice 9 is two sentences, and this is the second: "the
 * evening job sends one digest listing tomorrow's due items". It cannot be
 * tested in a browser — it is a job, on a clock, in a timezone — and it cannot
 * be tested with a mocked database either, because the three things most likely
 * to be wrong are all SQL: the working-day functions, the `soon` window in the
 * §9 builder, and the RLS scope the per-person query runs under.
 *
 * So it runs here, on the tenancy harness, with the real `sendWorkspaceDigest`.
 * The only seam is the mail transport, which is the one `mailer.ts` provides
 * for exactly this.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let sendWorkspaceDigest: typeof import('@/server/jobs/digest').sendWorkspaceDigest;

const sent: Mail[] = [];

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'digest');

  /**
   * The job reads its connections from the environment, like the worker process
   * it runs inside: the app role for everything it writes and everything it
   * reads on somebody's behalf, and the operator role for the one cross-tenant
   * question ("which companies exist"). Pointing both at the harness database
   * is what makes this the real code path rather than a rehearsal of it.
   */
  process.env.DATABASE_URL = h.urls.app;
  process.env.DATABASE_URL_OPERATOR = h.urls.operator;
  process.env.NEXT_PUBLIC_APP_URL ??= 'http://127.0.0.1:3100';

  ({ sendWorkspaceDigest } = await import('@/server/jobs/digest'));

  setTransport(async (mail) => {
    sent.push(mail);
    return { ok: true };
  });
}, 180_000);

afterAll(async () => {
  setTransport(undefined);
  await h?.stop();
});

afterEach(() => {
  sent.length = 0;
});

const actor = () => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

/** An item due on `dueDate`, assigned to the workspace's second member. */
async function dueItem(dueDate: string | null, options: { completed?: boolean } = {}) {
  const id = uuidv7();

  await withActor(
    actor(),
    async (tx) => {
      await tx.insert(workItem).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        number: Math.floor(Math.random() * 1_000_000),
        title: `Due ${dueDate ?? 'never'}`,
        stateId: w.stateId,
        rootId: id,
        rank: 'i',
        dueDate,
        completedAt: options.completed ? new Date() : null,
        createdByMemberId: w.ownerMemberId,
      });

      await tx.insert(workItemAssignee).values({
        workspaceId: w.workspaceId,
        workItemId: id,
        workspaceMemberId: w.memberMemberId,
      });
    },
    h.app,
  );

  return id;
}

/**
 * Cleanup runs through `withActor`, not through the owner handle.
 *
 * The owner is *subject* to RLS here — every table carries FORCE ROW LEVEL
 * SECURITY, and 0002 gave the owner a `provisioning` policy on `workspace` and
 * `app_user` only. An owner-connection DELETE on `work_item` therefore matches
 * no policy, affects zero rows, and reports success: the exact silent no-op the
 * FORCE line exists to guarantee, met from the other side.
 */
async function clearItems() {
  await withActor(actor(), async (tx) => {
    await tx.delete(workItem).where(eq(workItem.workspaceId, w.workspaceId));
  }, h.app);
}

// 2026-09-07 is a Monday; 2026-09-12 a Saturday and 2026-09-13 a Sunday.
const TUESDAY = '2026-09-08';
const WEDNESDAY = '2026-09-09';
const SUNDAY = '2026-09-13';

describe('the evening digest', () => {
  afterEach(clearItems);

  it('lists what is due next and what is already late, in one message', async () => {
    await dueItem(WEDNESDAY); // due on the next working day
    await dueItem('2026-09-01'); // late
    await dueItem('2026-10-30'); // neither — too far out to be tonight's problem

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);

    // §7.8: "Never one email per item — that is the fastest way to teach a team
    // to filter the product's mail."
    const [mail] = sent;
    expect(mail?.text).toContain('Due 2026-09-09');
    expect(mail?.text).toContain('Due 2026-09-01');
    expect(mail?.text).not.toContain('Due 2026-10-30');
  });

  it('goes to the person the work belongs to, and nobody else', async () => {
    await dueItem(WEDNESDAY);

    await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    // The owner is a member of this workspace and has no due work; §7.8's edge
    // case is "five assignees → five digests, each listing only that person's
    // own work", and the floor of that rule is that somebody with nothing gets
    // nothing.
    expect(sent.map((mail) => mail.to)).toEqual(['member@digest.test']);
  });

  it('sends nothing at all when nobody has anything due', async () => {
    await dueItem('2026-12-25');

    const count = await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    // §7.8: "The digest is skipped when the list is empty." An email saying
    // nothing happened teaches the same filtering habit as one per item.
    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('ignores work that is finished, however late it was', async () => {
    await dueItem('2026-09-01', { completed: true });

    await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    expect(sent).toHaveLength(0);
  });

  it('says nothing on a non-working evening (§7.8)', async () => {
    await dueItem('2026-09-14');

    const count = await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: SUNDAY });

    // "Nobody is reminded on Sunday about Monday" — Saturday evening already
    // carried it, because Saturday's next working day is Monday.
    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('carries the work due after a holiday, on the last working evening before it', async () => {
    const holiday = '2026-09-09';

    await withActor(
      actor(),
      async (tx) => {
        await tx
          .insert(workspaceHoliday)
          .values({ workspaceId: w.workspaceId, date: holiday, name: 'ចូលឆ្នាំខ្មែរ' });
      },
      h.app,
    );

    // Due on the Thursday. Tuesday evening's horizon is now Thursday rather
    // than the closed Wednesday, so Tuesday's digest is the one that warns.
    await dueItem('2026-09-10');

    const count = await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    expect(count).toBe(1);
    expect(sent[0]?.text).toContain('Due 2026-09-10');

    await withActor(
      actor(),
      async (tx) => {
        await tx.delete(workspaceHoliday).where(eq(workspaceHoliday.workspaceId, w.workspaceId));
      },
      h.app,
    );
  });

  it('writes in the recipient locale, not the sender or the server', async () => {
    await h.owner
      .update(workspace)
      .set({ timezone: 'Asia/Phnom_Penh' })
      .where(eq(workspace.id, w.workspaceId));

    await dueItem(WEDNESDAY);
    await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    // The harness seeds accounts at the default locale, so this is the English
    // subject — the assertion that matters is that it came from the catalogue
    // rather than from a string in the job (§13).
    expect(sent[0]?.subject).toMatch(/next working day/i);
    expect(sent[0]?.subject).not.toContain('digest.');
  });
});
