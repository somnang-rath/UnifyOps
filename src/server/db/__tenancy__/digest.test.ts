import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { setTransport } from '@/server/email/mailer';
import type { Mail } from '@/server/email/mailer';
import { withActor } from '../tenant';
import {
  project,
  wikiPage,
  wikiSpace,
  workItem,
  workItemAssignee,
  workspace,
  workspaceHoliday,
} from '../schema';
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

/**
 * §21.3's section on the same email (slice 19).
 *
 * §21.13's definition of done names this explicitly: "the digest section is
 * asserted in the worker's own test rather than only through the UI". It cannot
 * be tested in a browser for the reason none of the above can — it is a job, on
 * a clock, in a timezone — and it is the half of slice 19 with the most SQL
 * behind it: `working_days_ahead` resolving the horizon, the owner predicate,
 * and the read-as-that-member scope that keeps the email honest.
 *
 * §21.14's second check is the one that shaped the code: "a page owner with no
 * due work at all, on the evening before their page expires → the digest
 * arrives". Before slice 19 `digestFor` returned early when the work query came
 * back empty, and that early return is what would have silently swallowed this
 * whole feature.
 */
describe('the digest section for pages needing review', () => {
  afterEach(clearItems);

  /** A page in the company space, owned by the second member and lapsing on `expires`. */
  async function ownedPage(input: { title: string; expires: string | null }) {
    const spaceId = uuidv7();
    const pageId = uuidv7();
    const projectId = uuidv7();
    const suffix = String(Math.floor(Math.random() * 1_000_000));

    await withActor(actor(), async (tx) => {
      await tx.insert(project).values({
        id: projectId,
        workspaceId: w.workspaceId,
        teamId: w.teamId,
        slug: `digest-proj-${suffix}`,
        key: `D${suffix.slice(0, 4)}`,
        name: `Digest project ${suffix}`,
      });
    }, h.app);

    await withActor(actor(), async (tx) => {
      await tx.insert(wikiSpace).values({
        id: spaceId,
        workspaceId: w.workspaceId,
        kind: 'project',
        projectId,
        name: `Digest space ${suffix}`,
        slug: `digest-space-${suffix}`,
      });

      await tx.insert(wikiPage).values({
        id: pageId,
        workspaceId: w.workspaceId,
        spaceId,
        rootId: pageId,
        title: input.title,
        slug: `digest-page-${suffix}`,
        body: 'Body.',
        ownerMemberId: w.memberMemberId,
        // The pair together, because 0034's CHECK requires it and an expiry
        // with no verification is a lapse date for an assertion nobody made.
        verifiedAt: input.expires === null ? null : new Date('2026-01-01T00:00:00Z'),
        verifiedByMemberId: input.expires === null ? null : w.ownerMemberId,
        verificationExpiresAt: input.expires,
      });
    }, h.app);

    return { spaceId, pageId };
  }

  async function clearPages() {
    await withActor(actor(), async (tx) => {
      await tx.delete(wikiPage).where(eq(wikiPage.workspaceId, w.workspaceId));
      await tx.delete(wikiSpace).where(eq(wikiSpace.workspaceId, w.workspaceId));
    }, h.app);
  }

  afterEach(clearPages);

  /**
   * §21.14's check 2, and the reason `digestFor`'s early return moved.
   *
   * No due work at all — the work query returns nothing — and the digest still
   * arrives, naming the page. This is the assertion that would have failed
   * against the obvious implementation.
   */
  it('reaches an owner who has no due work at all', async () => {
    await ownedPage({ title: 'Leave policy', expires: WEDNESDAY });

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('Leave policy');
  });

  /**
   * Already-lapsed pages are included, and deliberately.
   *
   * A digest that only warned about the *coming* lapse would go quiet the
   * morning after one happened — exactly when the page most needs somebody to
   * look at it. That is the failure §17-19 records for due dates ("the first
   * time the product mentioned a due date was when the item was already
   * overdue"), and it would have been repeated here.
   */
  it('keeps naming a page whose review is already overdue', async () => {
    await ownedPage({ title: 'Expense rules', expires: '2026-08-01' });

    await sendWorkspaceDigest({ workspaceId: w.workspaceId, localDate: TUESDAY });

    expect(sent[0]?.text).toContain('Expense rules');
  });

  /** Beyond the seven-working-day horizon is not tonight's problem. */
  it('says nothing about a page lapsing months from now', async () => {
    await ownedPage({ title: 'Onboarding guide', expires: '2027-01-01' });

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    // No due work either, so there is nothing at all to send.
    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  /** A page with no review cycle never appears, which is *Never* working. */
  it('says nothing about a page with no review cycle', async () => {
    await ownedPage({ title: 'Scratch notes', expires: null });

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    expect(count).toBe(0);
  });

  /**
   * §21.3: "Nobody is notified page by page." One message carries both halves,
   * which is §7.8's rule — "never one email per item" — extended to a second
   * kind of thing worth reading.
   */
  it('carries work and pages in the same one message', async () => {
    await dueItem(WEDNESDAY);
    await ownedPage({ title: 'Security policy', expires: WEDNESDAY });

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('Due 2026-09-09');
    expect(sent[0]?.text).toContain('Security policy');
  });

  /**
   * An unowned page reaches nobody, which is the point of the column: §21.3
   * makes *owned by nobody* a visible state with a filter of its own rather than
   * a page that quietly emails the whole company.
   */
  it('says nothing about a page nobody owns', async () => {
    const { pageId } = await ownedPage({ title: 'Orphan page', expires: WEDNESDAY });

    await withActor(actor(), async (tx) => {
      await tx.update(wikiPage).set({ ownerMemberId: null }).where(eq(wikiPage.id, pageId));
    }, h.app);

    const count = await sendWorkspaceDigest({
      workspaceId: w.workspaceId,
      localDate: TUESDAY,
    });

    expect(count).toBe(0);
  });
});
