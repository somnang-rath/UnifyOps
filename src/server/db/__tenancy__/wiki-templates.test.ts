import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { project, wikiPage, wikiSpace } from '../schema';
import { fetchSpaceTemplates, fetchSpaceTree } from '@/server/queries/wiki';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * §21.7's templates against real Postgres (slice 22).
 *
 * **Everything asserted here is a rule migration 0040 states and the service
 * only restates.** §21.7 is one boolean column, and the two things that make it
 * coherent — *a template is a root page*, and *nothing hangs off a template* —
 * are exactly the kind of rule that has to hold for a row nobody in `src/server`
 * wrote. This slice is the first where that argument stops being hypothetical:
 * §21.8's importer is in the same slice, it writes pages in a loop, and it is
 * the caller most likely to get a tree wrong.
 *
 * The CHECK is one half and the trigger is the other, and they are separate
 * because they answer questions about different rows: whether *this* page has a
 * parent, and whether *that* page is a template. A row constraint can only see
 * the first.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'wiki-templates');
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

const as = <T>(fn: Parameters<typeof withActor<T>>[1]) => withActor(actor(), fn, h.app);

let seq = 0;
const nextSuffix = () => {
  seq += 1;
  return String(seq).padStart(3, '0');
};

async function makeSpace(): Promise<string> {
  const id = uuidv7();
  const projectId = uuidv7();
  const suffix = nextSuffix();

  await as(async (tx) => {
    await tx.insert(project).values({
      id: projectId,
      workspaceId: w.workspaceId,
      teamId: w.teamId,
      slug: `project-${suffix}`,
      key: `T${suffix}`,
      name: `Project ${suffix}`,
    });
    await tx.insert(wikiSpace).values({
      id,
      workspaceId: w.workspaceId,
      kind: 'project',
      projectId,
      name: 'Engineering',
      slug: `space-${suffix}`,
    });
  });

  return id;
}

async function makePage(input: {
  spaceId: string;
  parentId?: string | null;
  title?: string;
  isTemplate?: boolean;
}): Promise<string> {
  const id = uuidv7();

  await as(async (tx) => {
    await tx.insert(wikiPage).values({
      id,
      workspaceId: w.workspaceId,
      spaceId: input.spaceId,
      parentId: input.parentId ?? null,
      rootId: id,
      title: input.title ?? 'Untitled',
      slug: `page-${nextSuffix()}`,
      isTemplate: input.isTemplate ?? false,
    });
  });

  return id;
}

describe('a template is a root page (0040 CHECK)', () => {
  it('accepts a template with no parent', async () => {
    const spaceId = await makeSpace();
    const id = await makePage({ spaceId, title: 'Incident report', isTemplate: true });

    const [row] = await as(async (tx) =>
      tx.select({ isTemplate: wikiPage.isTemplate }).from(wikiPage).where(eq(wikiPage.id, id)),
    );
    expect(row?.isTemplate).toBe(true);
  });

  it('refuses a template created underneath another page', async () => {
    const spaceId = await makeSpace();
    const parentId = await makePage({ spaceId, title: 'Handbook' });

    const failure = await failureOf(
      makePage({ spaceId, parentId, title: 'Nested template', isTemplate: true }),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('wiki_page_template_is_root');
  });

  /**
   * The move that would have made a template nested, done as an UPDATE rather
   * than an INSERT — the path a CHECK covers and a service might not, because
   * `movePage` has no idea templates exist.
   */
  it('refuses giving an existing template a parent', async () => {
    const spaceId = await makeSpace();
    const parentId = await makePage({ spaceId, title: 'Handbook' });
    const templateId = await makePage({ spaceId, title: 'Runbook', isTemplate: true });

    const failure = await failureOf(
      as(async (tx) =>
        tx.update(wikiPage).set({ parentId }).where(eq(wikiPage.id, templateId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('wiki_page_template_is_root');
  });
});

describe('nothing hangs off a template (0040 trigger)', () => {
  /**
   * A fact about a *different row*, which is why this is a trigger rather than
   * the CHECK above: whether the parent is a template is not visible from the
   * child's own values.
   */
  it('refuses a page created under a template', async () => {
    const spaceId = await makeSpace();
    const templateId = await makePage({ spaceId, title: 'Meeting notes', isTemplate: true });

    const failure = await failureOf(makePage({ spaceId, parentId: templateId, title: 'Child' }));

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('template');
  });

  it('refuses moving an existing page under a template', async () => {
    const spaceId = await makeSpace();
    const templateId = await makePage({ spaceId, title: 'Decision record', isTemplate: true });
    const pageId = await makePage({ spaceId, title: 'Loose page' });

    const failure = await failureOf(
      as(async (tx) =>
        tx.update(wikiPage).set({ parentId: templateId }).where(eq(wikiPage.id, pageId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * The gap the trigger above cannot see, and the reason there is a second one.
   *
   * Flagging a page that *already has children* changes nothing about anybody's
   * `parent_id`, so the hierarchy trigger never fires and the CHECK only looks
   * at the page's own parent. `setPageTemplate` refuses this in words; the
   * database refuses it for the importer, which is a loop.
   */
  it('refuses turning a page with children into a template', async () => {
    const spaceId = await makeSpace();
    const parentId = await makePage({ spaceId, title: 'Handbook' });
    await makePage({ spaceId, parentId, title: 'Onboarding' });

    const failure = await failureOf(
      as(async (tx) =>
        tx.update(wikiPage).set({ isTemplate: true }).where(eq(wikiPage.id, parentId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('template');
  });

  /**
   * The other side of the same rule, and the reason `setPageTemplate` counts
   * only the *live* children: §20.3.6's 30-day window is a recovery promise, not
   * a claim that a deleted page is still in the tree.
   */
  it('allows a page whose children are all deleted to become one', async () => {
    const spaceId = await makeSpace();
    const parentId = await makePage({ spaceId, title: 'Handbook' });
    const childId = await makePage({ spaceId, parentId, title: 'Onboarding' });

    await as(async (tx) => {
      await tx.update(wikiPage).set({ deletedAt: new Date() }).where(eq(wikiPage.id, childId));
      await tx.update(wikiPage).set({ isTemplate: true }).where(eq(wikiPage.id, parentId));
    });

    const [row] = await as(async (tx) =>
      tx
        .select({ isTemplate: wikiPage.isTemplate })
        .from(wikiPage)
        .where(eq(wikiPage.id, parentId)),
    );
    expect(row?.isTemplate).toBe(true);
  });
});

describe('the tree hides templates and the picker finds them', () => {
  /**
   * §21.7's "hidden from the tree", asserted on the query rather than on the
   * sidebar — because `fetchSpaceTree` is not only the sidebar. It is also what
   * `createPageIn` and `movePage` read to compute a depth and a sibling
   * position, and what the parent picker is built from, so filtering there is
   * what makes a template un-offerable as a parent by a screen that forgot.
   */
  it('leaves a template out of fetchSpaceTree and in fetchSpaceTemplates', async () => {
    const spaceId = await makeSpace();
    await makePage({ spaceId, title: 'Handbook' });
    await makePage({ spaceId, title: 'Incident report', isTemplate: true });

    const [tree, templates] = await as(async (tx) => [
      await fetchSpaceTree(tx, spaceId),
      await fetchSpaceTemplates(tx, spaceId),
    ]);

    expect(tree.map((row) => row.title)).toEqual(['Handbook']);
    expect(templates.map((row) => row.title)).toEqual(['Incident report']);
  });

  it('leaves a deleted template out of both', async () => {
    const spaceId = await makeSpace();
    const id = await makePage({ spaceId, title: 'Old template', isTemplate: true });
    await as(async (tx) =>
      tx.update(wikiPage).set({ deletedAt: new Date() }).where(eq(wikiPage.id, id)),
    );

    const [tree, templates] = await as(async (tx) => [
      await fetchSpaceTree(tx, spaceId),
      await fetchSpaceTemplates(tx, spaceId),
    ]);

    expect(tree).toEqual([]);
    expect(templates).toEqual([]);
  });
});
