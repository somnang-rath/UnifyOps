import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import { withActor } from '../tenant';
import { project, workItem } from '../schema';
import { fetchWorkItemGroups } from '@/server/queries/work-items';
import { findItemByReference, findPeople } from '@/server/queries/search';
import { emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import type { TenantDb } from '../client';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * §7.9's search, against real Postgres (slice 14).
 *
 * The unit tests cover what a query *means* — which route it takes, what a
 * tsquery or a LIKE pattern comes out as, whether `ENG-142` parses. None of that
 * touches the database, and the database is where the half that actually fails
 * lives:
 *
 *   * the generated `search_text` column, which has to strip the same zero-width
 *     characters `normalizeQuery` does or a Khmer title with a break in it is
 *     unfindable;
 *   * `to_tsvector('simple', …) @@ to_tsquery('simple', …)` with a `:*` prefix,
 *     which is the only reason the palette matches before a word is finished;
 *   * `LIKE` against a lowercased column, which is the only shape a Khmer query
 *     can take at all;
 *   * and the claim that these two are questions about **one** string, which is
 *     the whole of §13's "Khmer is never the degraded path" in this feature.
 *
 * Every unit test in this repo passes with the column generating an empty string.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'search');
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

const run = <T>(fn: (tx: TenantDb) => Promise<T>) => withActor(actor(), fn, h.app);

const TODAY = '2026-09-03';

/** A real Khmer phrase, and the same phrase with a zero-width break in it. */
const PHNOM_PENH = 'ភ្នំពេញ';
const PHNOM_PENH_BROKEN = 'ភ្នំ​ពេញ';

let counter = 0;

async function makeItem(fields: { title: string; description?: string }): Promise<string> {
  const id = uuidv7();
  counter += 1;

  await run(async (tx) => {
    await tx.insert(workItem).values({
      id,
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      number: 5000 + counter,
      title: fields.title,
      description: fields.description ?? null,
      stateId: w.stateId,
      rootId: id,
      rank: `a${String(counter).padStart(4, '0')}1`,
      createdByMemberId: w.ownerMemberId,
    });
  });

  return id;
}

function searchQuery(text: string): WorkItemQuery {
  const base = emptyQuery();
  return {
    ...base,
    filters: { ...base.filters, projectIds: [w.projectId], text },
    groupBy: 'none',
    sort: 'updated',
    direction: 'desc',
  };
}

async function titlesMatching(text: string): Promise<string[]> {
  const groups = await run((tx) =>
    fetchWorkItemGroups(tx, searchQuery(text), { groupKeys: ['all'], today: TODAY }),
  );
  return (groups[0]?.rows ?? []).map((row) => row.title);
}

describe('the generated search column (migration 0025)', () => {
  it('folds case and joins the title to the description', async () => {
    const id = await makeItem({ title: 'Deploy The Gateway', description: 'Blocked on TLS' });

    const [row] = await run((tx) =>
      tx
        .select({ text: sql<string>`search_text` })
        .from(workItem)
        .where(sql`${workItem.id} = ${id}`),
    );

    expect(row?.text).toBe('deploy the gateway blocked on tls');
  });

  /**
   * §13's rule, in the one place it is load-bearing: "U+200B preserved in stored
   * text, stripped before indexing." The title keeps its break opportunity —
   * destroying it would change what somebody wrote and break Khmer line
   * breaking — and the indexed text does not, which is the only arrangement
   * where a search for the phrase finds the row.
   */
  it('strips zero-width characters from the index but not from the title', async () => {
    const id = await makeItem({ title: `Launch ${PHNOM_PENH_BROKEN}` });

    const [row] = await run((tx) =>
      tx
        .select({ title: workItem.title, text: sql<string>`search_text` })
        .from(workItem)
        .where(sql`${workItem.id} = ${id}`),
    );

    expect(row?.title).toContain('​');
    expect(row?.text).not.toContain('​');
    expect(row?.text).toContain(PHNOM_PENH);
  });

  it('is generated, so a direct UPDATE cannot leave a row unsearchable', async () => {
    const id = await makeItem({ title: 'Placeholder' });

    await run((tx) =>
      tx.update(workItem).set({ title: 'Renamed after the fact' }).where(sql`${workItem.id} = ${id}`),
    );

    const [row] = await run((tx) =>
      tx
        .select({ text: sql<string>`search_text` })
        .from(workItem)
        .where(sql`${workItem.id} = ${id}`),
    );

    expect(row?.text).toBe('renamed after the fact');
  });
});

describe('the Latin route — tsvector(simple)', () => {
  it('matches a whole word in the title', async () => {
    await makeItem({ title: 'Refactor the invoice exporter' });
    expect(await titlesMatching('invoice')).toContain('Refactor the invoice exporter');
  });

  it('matches a word in the description, not only the title', async () => {
    await makeItem({ title: 'Nightly job', description: 'Times out against the warehouse' });
    expect(await titlesMatching('warehouse')).toContain('Nightly job');
  });

  /**
   * The `:*` on the last term, which is what makes a palette feel alive. Without
   * it nothing matches until the word is finished, and a search box that shows
   * nothing for four keystrokes reads as broken.
   */
  it('matches a prefix of the last word', async () => {
    await makeItem({ title: 'Authentication rewrite' });
    expect(await titlesMatching('authent')).toContain('Authentication rewrite');
  });

  it('ANDs two words, because two words a person typed are two requirements', async () => {
    await makeItem({ title: 'Payment gateway timeout' });
    await makeItem({ title: 'Payment reconciliation' });

    expect(await titlesMatching('payment gateway')).toEqual(['Payment gateway timeout']);
  });

  it('is case-insensitive both ways', async () => {
    await makeItem({ title: 'MIGRATE the CDN' });
    expect(await titlesMatching('migrate')).toContain('MIGRATE the CDN');
    expect(await titlesMatching('CDN')).toContain('MIGRATE the CDN');
  });

  /**
   * `simple`, not `english`. An English stemmer would drop "no" and "off" as
   * stopwords, and a title like this is exactly the sort a tracker holds.
   */
  it('does not discard English stopwords', async () => {
    await makeItem({ title: 'No build off master' });
    expect(await titlesMatching('off master')).toContain('No build off master');
  });

  it('finds nothing for a query of pure punctuation rather than everything', async () => {
    await makeItem({ title: 'Something ordinary' });
    // A filter that cannot be evaluated must never silently widen the result.
    expect(await titlesMatching('!!!')).toEqual([]);
  });
});

describe('the Khmer route — pg_trgm', () => {
  /**
   * The reason the route exists. Khmer has no inter-word spaces, so
   * `to_tsvector` sees the whole phrase as one lexeme and only that exact whole
   * string could ever match it. A substring match is the one thing that finds a
   * word inside it.
   */
  it('finds a word inside a phrase with no spaces', async () => {
    const title = `បើកសាខានៅ${PHNOM_PENH}ក្នុងខែក្រោយ`;
    await makeItem({ title });
    // Named rather than counted: every Khmer row this file writes mentions the
    // same city, which is what a real workspace looks like too.
    expect(await titlesMatching(PHNOM_PENH)).toContain(title);
  });

  it('finds a title whose stored text carries a zero-width break', async () => {
    await makeItem({ title: `គម្រោង ${PHNOM_PENH_BROKEN}` });
    // The query has no break in it and the title does. They meet because both
    // sides are stripped — the column by migration 0025, the needle by
    // `normalizeQuery`.
    const found = await titlesMatching(PHNOM_PENH);
    expect(found.some((title) => title.includes('គម្រោង'))).toBe(true);
  });

  it('finds it when the query carries the break and the title does not', async () => {
    await makeItem({ title: `ផែនការ ${PHNOM_PENH}` });
    const found = await titlesMatching(PHNOM_PENH_BROKEN);
    expect(found.some((title) => title.includes('ផែនការ'))).toBe(true);
  });

  /**
   * Mixed script takes the trigram route, and this is why: the Latin route would
   * reduce the Khmer half to one lexeme nobody will ever type again, so a query
   * naming both a client and a place would match nothing.
   */
  it('handles a mixed-script query', async () => {
    await makeItem({ title: `Acme ${PHNOM_PENH} rollout` });
    expect(await titlesMatching(`Acme ${PHNOM_PENH}`)).toEqual([`Acme ${PHNOM_PENH} rollout`]);
  });

  // Slice 10 learned this with a client called "50% Co". Unescaped, `%` matches
  // every row in the company.
  it('escapes LIKE metacharacters', async () => {
    await makeItem({ title: `ការបញ្ចុះតម្លៃ 50% ${PHNOM_PENH}` });
    await makeItem({ title: `ការដឹកជញ្ជូន ${PHNOM_PENH}` });

    // A Khmer query, so the trigram route — and `%` inside it is a literal.
    const found = await titlesMatching(`50% ${PHNOM_PENH}`);
    expect(found).toHaveLength(1);
  });
});

describe('the two routes read one string (§13)', () => {
  /**
   * The property that makes "Khmer is never the degraded path" true here rather
   * than aspirational: a description is searchable in both languages, because
   * both routes read the same generated column.
   */
  it('searches the description in both scripts', async () => {
    await makeItem({
      title: 'Quarterly report',
      description: `ត្រូវបញ្ចប់មុនពេលបិទបញ្ជីនៅ${PHNOM_PENH}`,
    });

    expect(await titlesMatching('quarterly')).toContain('Quarterly report');
    expect(await titlesMatching(PHNOM_PENH)).toContain('Quarterly report');
  });
});

describe('scope (§7.9, §17-17)', () => {
  it('excludes items in an archived project by default and includes them on request', async () => {
    const archivedId = uuidv7();
    const itemId = uuidv7();

    await run(async (tx) => {
      await tx.insert(project).values({
        id: archivedId,
        workspaceId: w.workspaceId,
        teamId: w.teamId,
        slug: 'shuttered',
        key: 'SHUT',
        name: 'Shuttered',
        archivedAt: new Date(),
      });
      await tx.insert(workItem).values({
        id: itemId,
        workspaceId: w.workspaceId,
        projectId: archivedId,
        number: 1,
        title: 'Hibernating widget',
        stateId: w.stateId,
        rootId: itemId,
        rank: 'z0001',
        createdByMemberId: w.ownerMemberId,
      });
    });

    const base = emptyQuery();
    const ask = (includeArchived: boolean) =>
      run((tx) =>
        fetchWorkItemGroups(
          tx,
          {
            ...base,
            filters: {
              ...base.filters,
              projectIds: [archivedId],
              text: 'hibernating',
              includeArchivedProjects: includeArchived,
            },
            groupBy: 'none',
          },
          { groupKeys: ['all'], today: TODAY },
        ),
      );

    expect((await ask(false))[0]?.rows).toEqual([]);
    expect((await ask(true))[0]?.rows).toHaveLength(1);
  });

  // §7.9: "Soft-deleted items never appear in search and are reachable only from
  // the 30-day recovery screen."
  it('never returns a soft-deleted item', async () => {
    const id = await makeItem({ title: 'Retracted proposal' });
    await run((tx) =>
      tx.update(workItem).set({ deletedAt: new Date() }).where(sql`${workItem.id} = ${id}`),
    );

    expect(await titlesMatching('retracted')).toEqual([]);
  });
});

describe('the ENG-142 short-circuit', () => {
  it('resolves an identifier to its item', async () => {
    const id = uuidv7();
    await run((tx) =>
      tx.insert(workItem).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        number: 142,
        title: 'The one you meant',
        stateId: w.stateId,
        rootId: id,
        rank: 'm0001',
        createdByMemberId: w.ownerMemberId,
      }),
    );

    const [key] = await run((tx) =>
      tx.select({ key: project.key }).from(project).where(sql`${project.id} = ${w.projectId}`),
    );

    const hit = await run((tx) => findItemByReference(tx, key!.key.toUpperCase(), 142));
    expect(hit?.title).toBe('The one you meant');
  });

  it('is null for a number nobody has issued', async () => {
    const hit = await run((tx) => findItemByReference(tx, 'NOPE', 999_999));
    expect(hit).toBeNull();
  });
});

describe('people', () => {
  it('matches a name or an email, folded', async () => {
    const byEmail = await run((tx) => findPeople(tx, 'owner', 5));
    expect(byEmail.length).toBeGreaterThan(0);
  });

  it('finds nobody for a string nobody carries', async () => {
    expect(await run((tx) => findPeople(tx, 'zzzznobody', 5))).toEqual([]);
  });
});
