import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { project, wikiPage, wikiPageLabel, wikiSpace, label } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Ownership and verification against real Postgres (§21.3 — slice 19).
 *
 * §21.13's definition of done for this slice is two things: "editing a verified
 * page clears its verification, and the digest section is asserted in the
 * worker's own test rather than only through the UI." The first has a database
 * half and it is here; the second is `digest.test.ts`.
 *
 * What is pinned here is what only a database can say — the invariants that
 * hold for a row written by a seed script, a Markdown importer or a Phase 2 MCP
 * tool, which is why 0034 carries them rather than `services/wiki.ts`:
 *
 *  - a verification is a **whole fact** or none: both columns or neither;
 *  - an expiry with no verification is a lapse date for an assertion nobody
 *    made, and is refused;
 *  - a space's review cycle cannot be set to a value that makes every new page
 *    born expired (§6's "no setting can put a workspace in an unrecoverable
 *    state");
 *  - `working_days_ahead` consults the company's calendar rather than counting
 *    calendar days — the property that makes the amber badge mean *lead time to
 *    act*;
 *  - the conditional update that refuses a stale verification, which is the
 *    same single statement `saveWikiPage` uses and for a sharper reason.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'wiki-verify');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = (ws: SeededWorkspace = w) => ({
  workspaceId: ws.workspaceId,
  userId: ws.ownerUserId,
  actorUserId: ws.ownerUserId,
  readOnly: false,
});

const as = <T>(ws: SeededWorkspace, fn: Parameters<typeof withActor<T>>[1]) =>
  withActor(actor(ws), fn, h.app);

/** A counter for fixture slugs — `wiki.test.ts`'s note about UUIDv7 applies. */
let seq = 0;
const nextSuffix = () => {
  seq += 1;
  return `v${String(seq).padStart(3, '0')}`;
};

async function makeSpace(days: number | null = null): Promise<string> {
  const id = uuidv7();
  const projectId = uuidv7();
  const suffix = nextSuffix();

  // Its own transaction, before the space's: `withActor` opens one connection
  // and a nested `as` would deadlock against it.
  await as(w, async (tx) => {
    await tx.insert(project).values({
      id: projectId,
      workspaceId: w.workspaceId,
      teamId: w.teamId,
      slug: `proj-${suffix}`,
      key: suffix.toUpperCase(),
      name: `Project ${suffix}`,
    });
  });

  await as(w, async (tx) => {
    await tx.insert(wikiSpace).values({
      id,
      workspaceId: w.workspaceId,
      kind: 'project',
      projectId,
      name: `Space ${suffix}`,
      slug: `space-${suffix}`,
      defaultVerificationDays: days,
    });
  });

  return id;
}

async function makePage(spaceId: string): Promise<string> {
  const id = uuidv7();

  await as(w, async (tx) => {
    await tx.insert(wikiPage).values({
      id,
      workspaceId: w.workspaceId,
      spaceId,
      rootId: id,
      title: `Page ${nextSuffix()}`,
      slug: `page-${nextSuffix()}`,
      body: 'Original body.',
    });
  });

  return id;
}

/* ------------------------------------------------------------------------- */

describe('the verification pair', () => {
  /**
   * §21.3: "Both are set and cleared together, under a CHECK, because half of
   * this pair is not a fact."
   *
   * Both halves asserted, because a CHECK written the other way round
   * (`num_nonnulls(...) <> 1`) would pass one of these and fail the other, and a
   * test that only tried one direction could not tell.
   */
  it('refuses a timestamp with no author', async () => {
    const pageId = await makePage(await makeSpace());

    const failure = await failureOf(
      as(w, (tx) =>
        tx.update(wikiPage).set({ verifiedAt: new Date() }).where(eq(wikiPage.id, pageId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('wiki_page_verification_pair');
  });

  it('refuses an author with no timestamp', async () => {
    const pageId = await makePage(await makeSpace());

    const failure = await failureOf(
      as(w, (tx) =>
        tx
          .update(wikiPage)
          .set({ verifiedByMemberId: w.ownerMemberId })
          .where(eq(wikiPage.id, pageId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('accepts the pair together, with and without a review cycle', async () => {
    const pageId = await makePage(await makeSpace());

    await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ verifiedAt: new Date(), verifiedByMemberId: w.ownerMemberId })
        .where(eq(wikiPage.id, pageId)),
    );

    await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ verificationExpiresAt: '2027-03-04' })
        .where(eq(wikiPage.id, pageId)),
    );

    const [row] = await as(w, (tx) =>
      tx
        .select({
          verifiedAt: wikiPage.verifiedAt,
          expires: wikiPage.verificationExpiresAt,
        })
        .from(wikiPage)
        .where(eq(wikiPage.id, pageId)),
    );

    expect(row?.verifiedAt).not.toBeNull();
    // A `date` column comes back as `YYYY-MM-DD`, which is what
    // `verificationStatus` compares as a string — the shape every date in this
    // product crosses a boundary in.
    expect(row?.expires).toBe('2027-03-04');
  });

  /**
   * An expiry with no verification is a lapse date for an assertion nobody made.
   * The reverse is legitimate and is the common case, which the test above pins.
   */
  it('refuses an expiry on a page nobody has verified', async () => {
    const pageId = await makePage(await makeSpace());

    const failure = await failureOf(
      as(w, (tx) =>
        tx
          .update(wikiPage)
          .set({ verificationExpiresAt: '2027-03-04' })
          .where(eq(wikiPage.id, pageId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('wiki_page_expiry_needs_verification');
  });
});

describe('the conditional verification', () => {
  /**
   * §21.3's `[X]`, and the sharpest instance of §20.3.3's rule in the product.
   *
   * A stale *save* refuses because merging prose destroys work. A stale
   * *verification* refuses because it would otherwise attach somebody's name,
   * permanently and in the audit log, to words they never read. Same single
   * statement, stronger reason.
   *
   * Asserted at the database rather than through the service, because what makes
   * it safe is that it is **one statement**: a `SELECT` then an `UPDATE` has a
   * window between them that two verifications both pass, and only a test
   * against the real `where` clause can tell the two implementations apart.
   */
  it('lands on the revision it was based on', async () => {
    const pageId = await makePage(await makeSpace());

    const updated = await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ verifiedAt: new Date(), verifiedByMemberId: w.ownerMemberId })
        .where(and(eq(wikiPage.id, pageId), eq(wikiPage.revisionNo, 1)))
        .returning({ id: wikiPage.id }),
    );

    expect(updated).toHaveLength(1);
  });

  it('writes nothing when the page has moved on underneath', async () => {
    const pageId = await makePage(await makeSpace());

    // Somebody else saves — which is exactly what `saveWikiPage` does, including
    // clearing any verification the page had.
    await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ revisionNo: 2, body: 'Rewritten.' })
        .where(eq(wikiPage.id, pageId)),
    );

    const updated = await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ verifiedAt: new Date(), verifiedByMemberId: w.ownerMemberId })
        .where(and(eq(wikiPage.id, pageId), eq(wikiPage.revisionNo, 1)))
        .returning({ id: wikiPage.id }),
    );

    expect(updated).toHaveLength(0);

    // And the row is genuinely untouched — a zero-row `returning` would look the
    // same if the update had landed and returned nothing.
    const [row] = await as(w, (tx) =>
      tx.select({ verifiedAt: wikiPage.verifiedAt }).from(wikiPage).where(eq(wikiPage.id, pageId)),
    );
    expect(row?.verifiedAt).toBeNull();
  });
});

describe('the space default', () => {
  /**
   * §6's second half, the rule 0028 states as "no setting can put a workspace in
   * an unrecoverable state".
   *
   * A default of zero or a negative number resolves every new page's expiry to
   * today or to the past, so every page created in that space would be born
   * expired — a wiki reporting its whole contents as untrustworthy on the
   * morning it is created, with nothing on screen explaining why.
   */
  it('refuses a cycle that would make every page born expired', async () => {
    const spaceId = await makeSpace();

    for (const days of [0, -1]) {
      const failure = await failureOf(
        as(w, (tx) =>
          tx
            .update(wikiSpace)
            .set({ defaultVerificationDays: days })
            .where(eq(wikiSpace.id, spaceId)),
        ),
      );
      expect(failure.code).toBe(SQLSTATE.checkViolation);
    }
  });

  it('refuses a cycle beyond the ten-year bound', async () => {
    const spaceId = await makeSpace();

    const failure = await failureOf(
      as(w, (tx) =>
        tx
          .update(wikiSpace)
          .set({ defaultVerificationDays: 3_651 })
          .where(eq(wikiSpace.id, spaceId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * **Bounded, not enumerated.** `VERIFICATION_DAYS` is a fact about
   * `src/lib/wiki.ts`, and 0034 declines to list it for the reason 0028 declined
   * to list the locales — a CHECK naming the three periods would have to be
   * migrated in step with adding a fourth. This test is what says that is
   * deliberate rather than an oversight.
   */
  it('accepts a period the code does not currently offer', async () => {
    const spaceId = await makeSpace();

    await as(w, (tx) =>
      tx.update(wikiSpace).set({ defaultVerificationDays: 30 }).where(eq(wikiSpace.id, spaceId)),
    );

    const [row] = await as(w, (tx) =>
      tx
        .select({ days: wikiSpace.defaultVerificationDays })
        .from(wikiSpace)
        .where(eq(wikiSpace.id, spaceId)),
    );

    expect(row?.days).toBe(30);
  });

  it('accepts null, which is Never and is the default', async () => {
    const spaceId = await makeSpace();

    const [row] = await as(w, (tx) =>
      tx
        .select({ days: wikiSpace.defaultVerificationDays })
        .from(wikiSpace)
        .where(eq(wikiSpace.id, spaceId)),
    );

    expect(row?.days).toBeNull();
  });
});

describe('working_days_ahead', () => {
  /**
   * §9's fifth working-day function, and the property that makes it worth being
   * one: it consults the company's calendar rather than counting calendar days.
   *
   * The seeded mask is 63 — Monday to Saturday, the market §2.5 describes — so
   * counting **strictly forward** from Monday the 7th the working days are Tue 8,
   * Wed 9, Thu 10, Fri 11, Sat 12, *(Sunday skipped)*, Mon 14, Tue 15. The
   * seventh is Tuesday the 15th, where seven calendar days would have said
   * Monday the 14th — and the one-day gap is the whole reason this is a SQL
   * function consulting the company's calendar rather than an addition.
   */
  it('skips non-working days', async () => {
    const [row] = await as(w, (tx) =>
      tx.execute<{ ahead: string }>(
        // 2026-09-07 is a Monday.
        sql`select working_days_ahead(${w.workspaceId}::uuid, '2026-09-07'::date, 7)::text as ahead`,
      ),
    ).then((result) => result.rows);

    expect(row?.ahead).toBe('2026-09-15');
  });

  /** One working day ahead of a Saturday is the following Monday, not Sunday. */
  it('steps over the weekly rest day', async () => {
    const [row] = await as(w, (tx) =>
      tx.execute<{ ahead: string }>(
        // 2026-09-12 is a Saturday, which the mask of 63 counts as a working day.
        sql`select working_days_ahead(${w.workspaceId}::uuid, '2026-09-12'::date, 1)::text as ahead`,
      ),
    ).then((result) => result.rows);

    expect(row?.ahead).toBe('2026-09-14');
  });

  /**
   * A holiday flattens it exactly as it flattens a burndown's ideal line
   * (§17-18). This is the property that makes the amber badge mean *lead time to
   * act* rather than *days on a calendar*: a company closed for Khmer New Year
   * is warned before the holiday rather than during it.
   */
  it('steps over a workspace holiday', async () => {
    await as(w, (tx) =>
      tx.execute(
        sql`insert into workspace_holiday (id, workspace_id, date, name)
            values (${uuidv7()}::uuid, ${w.workspaceId}::uuid, '2026-09-08'::date, 'Test holiday')
            on conflict do nothing`,
      ),
    );

    const [row] = await as(w, (tx) =>
      tx.execute<{ ahead: string }>(
        sql`select working_days_ahead(${w.workspaceId}::uuid, '2026-09-07'::date, 1)::text as ahead`,
      ),
    ).then((result) => result.rows);

    // Tuesday the 8th is a holiday, so one working day past Monday is Wednesday.
    expect(row?.ahead).toBe('2026-09-09');
  });
});

describe('page labels', () => {
  /**
   * §21.3: "Tags are `label`, not a second vocabulary." The join table is
   * `work_item_label` with one column renamed, down to the cascade — so deleting
   * a label from the workspace's vocabulary takes its applications with it,
   * which is what keeps §7.11's promise true for pages as well as items.
   */
  it('goes with the label it applies', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage(spaceId);
    const labelId = uuidv7();

    await as(w, (tx) =>
      tx.insert(label).values({
        id: labelId,
        workspaceId: w.workspaceId,
        name: `Label ${nextSuffix()}`,
        color: 'sky',
      }),
    );

    await as(w, (tx) =>
      tx.insert(wikiPageLabel).values({
        id: uuidv7(),
        workspaceId: w.workspaceId,
        pageId,
        labelId,
      }),
    );

    await as(w, (tx) => tx.delete(label).where(eq(label.id, labelId)));

    const rows = await as(w, (tx) =>
      tx.select().from(wikiPageLabel).where(eq(wikiPageLabel.pageId, pageId)),
    );

    expect(rows).toHaveLength(0);
  });

  it('refuses the same label twice on one page', async () => {
    const pageId = await makePage(await makeSpace());
    const labelId = uuidv7();

    await as(w, (tx) =>
      tx.insert(label).values({
        id: labelId,
        workspaceId: w.workspaceId,
        name: `Label ${nextSuffix()}`,
        color: 'navy',
      }),
    );

    const apply = () =>
      as(w, (tx) =>
        tx.insert(wikiPageLabel).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          pageId,
          labelId,
        }),
      );

    await apply();
    const failure = await failureOf(apply());
    expect(failure.code).toBe(SQLSTATE.uniqueViolation);
  });
});

describe('releasing a departing owner', () => {
  /**
   * §21.3's `[!]`, and the half of §20.5's asymmetry that survives.
   *
   * "The removal nulls the column rather than deleting anything, so those pages
   * appear under *owned by nobody* the next morning." Notes are destroyed with
   * the membership and pages are not — `note_owner_fk` cascades where this
   * column is simply cleared, and the page stays exactly where it was.
   */
  it('leaves the page and clears the column', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage(spaceId);

    await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ ownerMemberId: w.memberMemberId })
        .where(eq(wikiPage.id, pageId)),
    );

    const released = await as(w, (tx) =>
      tx
        .update(wikiPage)
        .set({ ownerMemberId: null })
        .where(eq(wikiPage.ownerMemberId, w.memberMemberId))
        .returning({ id: wikiPage.id }),
    );

    expect(released.map((row) => row.id)).toContain(pageId);

    const [row] = await as(w, (tx) =>
      tx
        .select({ ownerMemberId: wikiPage.ownerMemberId, title: wikiPage.title })
        .from(wikiPage)
        .where(eq(wikiPage.id, pageId)),
    );

    expect(row?.ownerMemberId).toBeNull();
    // The page itself is untouched, which is the whole distinction from a note.
    expect(row?.title).toBeTruthy();
  });
});
