import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { workItem } from '../schema';
import { rankAfter, rankBetween } from '@/lib/rank';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * The board's order is a **string comparison in Postgres**, and this file is the
 * only place that is checked.
 *
 * `src/lib/rank.test.ts` proves the fractional index is correct in JavaScript.
 * That is half the guarantee. The other half is that the database sorts those
 * same keys the same way — and it is the half that fails silently: a board
 * ordered by a collation that disagrees with the generator reorders itself once,
 * on deploy day, with every unit test still green.
 *
 * Two decisions from slice 5 are what make the halves agree, and both are
 * asserted here rather than trusted:
 *
 *   * migration 0008 pins `work_item.rank` to `COLLATE "C"`, so comparison is
 *     byte order rather than language order;
 *   * `rank.ts` narrows the alphabet to lowercase base-36, so even without the
 *     collation there is no case for a collation to have an opinion about.
 *
 * Either one alone would do. Having both is why this file asserts the *result*
 * — the order Postgres returns — rather than either mechanism.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'rank-order');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = () => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

let nextNumber = 1;

async function insertRanked(ranks: readonly string[]): Promise<void> {
  await withActor(
    actor(),
    async (tx) => {
      for (const rank of ranks) {
        const id = uuidv7();
        await tx.insert(workItem).values({
          id,
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          number: nextNumber++,
          title: rank,
          stateId: w.stateId,
          rootId: id,
          rank,
          createdByMemberId: w.ownerMemberId,
        });
      }
    },
    h.app,
  );
}

/** Titles in the order Postgres puts them, which is the order a board draws. */
async function orderedByRank(): Promise<string[]> {
  return withActor(
    actor(),
    async (tx) => {
      const rows = await tx
        .select({ title: workItem.title })
        .from(workItem)
        .where(eq(workItem.stateId, w.stateId))
        .orderBy(asc(workItem.rank));
      return rows.map((row) => row.title);
    },
    h.app,
  );
}

describe('the database orders ranks the way the generator does', () => {
  it('agrees with a JavaScript sort over keys built by repeated insertion', async () => {
    // `ordered` is the column as it actually stands, so every rank in it is a
    // rank some card really holds — no duplicates, and each drop is computed
    // against its true neighbours the way the server computes one.
    const ordered: string[] = [rankAfter(null, () => 0.5)];
    for (let i = 0; i < 40; i += 1) {
      ordered.push(rankAfter(ordered[ordered.length - 1] ?? null, () => 0.5));
    }

    // Drop repeatedly into the same gap. Each drop halves the space left, so the
    // keys lengthen — which is the case `midpoint`'s recursion exists for, and
    // the case where a byte-order disagreement would first become visible.
    for (const gap of [0, 5, 20, ordered.length - 1]) {
      for (let i = 0; i < 12; i += 1) {
        const before = ordered[gap] ?? null;
        const after = ordered[gap + 1] ?? null;
        ordered.splice(gap + 1, 0, rankBetween(before, after));
      }
    }

    await insertRanked(ordered);

    const fromDatabase = await orderedByRank();
    const fromJavaScript = [...ordered].sort();

    // The list was built in order, so Postgres must return it unchanged — a
    // stronger claim than "both sorts agree", and the one the board relies on.
    expect(fromDatabase).toEqual(ordered);
    // And the generator's own idea of the order is the same one — so the two
    // halves of the guarantee are checked against construction, not each other.
    expect(fromJavaScript).toEqual(ordered);
  });

  it('puts digits before letters, which byte order does and several collations do not', async () => {
    // `9` and `a` are adjacent in this alphabet and are the pair a language
    // collation is most likely to reorder or to treat as equal.
    const probes = ['1', '19', '9', '91', 'a', 'a1', 'az', 'z', 'z1', 'zz'];

    await withActor(
      actor(),
      async (tx) => {
        await tx.delete(workItem).where(eq(workItem.stateId, w.stateId));
      },
      h.app,
    );
    await insertRanked(probes);

    expect(await orderedByRank()).toEqual([
      '1',
      '19',
      '9',
      '91',
      'a',
      'a1',
      'az',
      'z',
      'z1',
      'zz',
    ]);
  });
});
