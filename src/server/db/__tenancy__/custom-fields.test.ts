import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { customField, customFieldOption, customFieldValue, workItem } from '../schema';
import { fetchWorkItemGroups } from '@/server/queries/work-items';
import { NONE, emptyQuery, type CustomFilter, type WorkItemQuery } from '@/lib/work-item-query';
import { customGroupBy, type CustomFieldKind } from '@/lib/custom-fields';
import type { TenantDb } from '../client';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Custom fields against real Postgres (§6-4, slice 10).
 *
 * Three things here are only true if a database says so, and each one is a
 * decision the code above it depends on rather than a detail:
 *
 *   * **The CHECK in migration 0018.** "Typed indexed columns per value kind"
 *     (§9) is a claim about rows, not about TypeScript — a value written by a
 *     seed script, an importer or a Phase 2 MCP tool has to be as correct as one
 *     written by the service. Slice 5 made the same argument for `root_id` and
 *     the assignee arrays.
 *
 *   * **The trigger that clears a deleted option.** `value_option_ids` is an
 *     array and an array cannot carry a foreign key, so the only thing standing
 *     between a deleted option and a value pointing at nothing is that trigger.
 *
 *   * **The filter and grouping SQL.** §9's "one branch in the builder" is an
 *     `EXISTS` per kind and a `LATERAL` fan-out per grouping. The unit tests
 *     cover the DSL, which never touches SQL; this covers the half that fails.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'fields-a');
  other = await seedWorkspace(h, 'fields-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = (workspace: SeededWorkspace = w) => ({
  workspaceId: workspace.workspaceId,
  userId: workspace.ownerUserId,
  actorUserId: workspace.ownerUserId,
  readOnly: false,
});

const TODAY = '2026-09-03';

/** A field on the seeded project, with its options. Returns the ids. */
async function defineField(
  kind: CustomFieldKind,
  optionNames: string[] = [],
  workspace: SeededWorkspace = w,
): Promise<{ fieldId: string; optionIds: string[] }> {
  const fieldId = uuidv7();
  const optionIds: string[] = [];

  await withActor(
    actor(workspace),
    async (tx) => {
      await tx.insert(customField).values({
        id: fieldId,
        workspaceId: workspace.workspaceId,
        projectId: workspace.projectId,
        name: `${kind}-${fieldId.slice(-6)}`,
        kind,
      });

      for (const [index, name] of optionNames.entries()) {
        const optionId = uuidv7();
        optionIds.push(optionId);
        await tx.insert(customFieldOption).values({
          id: optionId,
          workspaceId: workspace.workspaceId,
          fieldId,
          name,
          position: index * 100,
        });
      }
    },
    h.app,
  );

  return { fieldId, optionIds };
}

async function makeItem(title: string, workspace: SeededWorkspace = w): Promise<string> {
  const id = uuidv7();
  await withActor(
    actor(workspace),
    async (tx) => {
      await tx.insert(workItem).values({
        id,
        workspaceId: workspace.workspaceId,
        projectId: workspace.projectId,
        number: Math.floor(Math.random() * 1_000_000),
        title,
        stateId: workspace.stateId,
        rootId: id,
        rank: `a${Math.random().toString(36).slice(2, 8)}`,
        createdByMemberId: workspace.ownerMemberId,
      });
    },
    h.app,
  );
  return id;
}

/** Writes one value row, whatever the columns say — the point is what the database allows. */
async function writeValue(
  values: Partial<typeof customFieldValue.$inferInsert> & {
    workItemId: string;
    fieldId: string;
    kind: CustomFieldKind;
  },
  workspace: SeededWorkspace = w,
) {
  return withActor(
    actor(workspace),
    (tx: TenantDb) =>
      tx.insert(customFieldValue).values({
        id: uuidv7(),
        workspaceId: workspace.workspaceId,
        ...values,
      }),
    h.app,
  );
}

describe('tenant isolation', () => {
  it('hides another workspace fields, options and values', async () => {
    const mine = await defineField('select', ['Acme']);
    const theirs = await defineField('select', ['Beta'], other);
    const theirItem = await makeItem('theirs', other);

    await writeValue(
      { workItemId: theirItem, fieldId: theirs.fieldId, kind: 'select', valueOptionIds: [theirs.optionIds[0]!] },
      other,
    );

    const seen = await withActor(
      actor(),
      async (tx) => ({
        fields: await tx.select({ id: customField.id }).from(customField),
        options: await tx.select({ id: customFieldOption.id }).from(customFieldOption),
        values: await tx.select({ id: customFieldValue.id }).from(customFieldValue),
      }),
      h.app,
    );

    // RLS, not a WHERE clause: these queries name no workspace at all, which is
    // the deliberately unscoped query §15 asks this suite to prove returns
    // nothing rather than somebody else's rows.
    expect(seen.fields.map((row) => row.id)).toContain(mine.fieldId);
    expect(seen.fields.map((row) => row.id)).not.toContain(theirs.fieldId);
    expect(seen.options.map((row) => row.id)).not.toContain(theirs.optionIds[0]);
    expect(seen.values).toHaveLength(0);
  });

  it('refuses a value on another workspace item', async () => {
    const { fieldId } = await defineField('text');
    const theirItem = await makeItem('theirs', other);

    // The composite foreign key cannot even resolve: `(work_item_id,
    // workspace_id)` names no row this scope can see.
    const failure = await failureOf(
      writeValue({ workItemId: theirItem, fieldId, kind: 'text', valueText: 'x' }),
    );
    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('the kind CHECK (migration 0018)', () => {
  it('refuses a value in the column the kind does not name', async () => {
    const { fieldId } = await defineField('text');
    const item = await makeItem('wrong column');

    const failure = await failureOf(
      writeValue({ workItemId: item, fieldId, kind: 'text', valueNumber: '5' }),
    );
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a row that populates two columns', async () => {
    const { fieldId } = await defineField('text');
    const item = await makeItem('two columns');

    const failure = await failureOf(
      writeValue({ workItemId: item, fieldId, kind: 'text', valueText: 'x', valueDate: '2026-09-03' }),
    );
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a row with no value at all', async () => {
    // "No value" is the absence of the row. A row full of nulls would make
    // every `NOT EXISTS` in the builder wrong.
    const { fieldId } = await defineField('text');
    const item = await makeItem('empty row');

    const failure = await failureOf(writeValue({ workItemId: item, fieldId, kind: 'text' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a checkbox stored as false', async () => {
    // An unticked box is the absence of the row — which is also the correct
    // answer for every item that existed before the field was added.
    const { fieldId } = await defineField('checkbox');
    const item = await makeItem('unticked');

    const failure = await failureOf(
      writeValue({ workItemId: item, fieldId, kind: 'checkbox', valueCheckbox: false }),
    );
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses an empty option array, and a second option on a single select', async () => {
    const { fieldId, optionIds } = await defineField('select', ['A', 'B']);
    const item = await makeItem('select bounds');

    expect(
      (await failureOf(writeValue({ workItemId: item, fieldId, kind: 'select', valueOptionIds: [] })))
        .code,
    ).toBe(SQLSTATE.checkViolation);

    expect(
      (
        await failureOf(
          writeValue({ workItemId: item, fieldId, kind: 'select', valueOptionIds: optionIds }),
        )
      ).code,
    ).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a value whose kind disagrees with its field', async () => {
    // The composite foreign key carries `kind`, which is what pins a field's
    // kind for life: a value cannot describe itself as a date while its field
    // says text.
    const { fieldId } = await defineField('text');
    const item = await makeItem('kind mismatch');

    const failure = await failureOf(
      writeValue({ workItemId: item, fieldId, kind: 'date', valueDate: '2026-09-03' }),
    );
    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('deleting an option', () => {
  it('strips it from the values that named it, and deletes the ones left empty', async () => {
    const { fieldId, optionIds } = await defineField('multi_select', ['A', 'B']);
    const [a, b] = optionIds as [string, string];

    const both = await makeItem('both options');
    const onlyA = await makeItem('one option');

    await writeValue({ workItemId: both, fieldId, kind: 'multi_select', valueOptionIds: [a, b] });
    await writeValue({ workItemId: onlyA, fieldId, kind: 'multi_select', valueOptionIds: [a] });

    await withActor(
      actor(),
      (tx) => tx.delete(customFieldOption).where(eq(customFieldOption.id, a)),
      h.app,
    );

    const rows = await withActor(
      actor(),
      (tx) =>
        tx
          .select({ workItemId: customFieldValue.workItemId, ids: customFieldValue.valueOptionIds })
          .from(customFieldValue)
          .where(eq(customFieldValue.fieldId, fieldId)),
      h.app,
    );

    // The row that named both keeps the survivor; the row that named only the
    // deleted option is gone rather than left as an empty array the CHECK would
    // refuse.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workItemId).toBe(both);
    expect(rows[0]?.ids).toEqual([b]);
  });
});

describe('deleting a field', () => {
  it('takes its options and its values with it', async () => {
    const { fieldId, optionIds } = await defineField('select', ['A']);
    const item = await makeItem('cascade');
    await writeValue({
      workItemId: item,
      fieldId,
      kind: 'select',
      valueOptionIds: [optionIds[0]!],
    });

    await withActor(actor(), (tx) => tx.delete(customField).where(eq(customField.id, fieldId)), h.app);

    const left = await withActor(
      actor(),
      async (tx) => ({
        options: await tx
          .select({ id: customFieldOption.id })
          .from(customFieldOption)
          .where(eq(customFieldOption.fieldId, fieldId)),
        values: await tx
          .select({ id: customFieldValue.id })
          .from(customFieldValue)
          .where(eq(customFieldValue.fieldId, fieldId)),
      }),
      h.app,
    );

    expect(left.options).toHaveLength(0);
    expect(left.values).toHaveLength(0);
  });
});

/**
 * §9's "a `custom:{fieldId}` filter is one branch in the builder", exercised
 * through the real builder against real rows.
 */
describe('the filter branch', () => {
  const query = (custom: CustomFilter[], groupBy?: string): WorkItemQuery => {
    const base = emptyQuery();
    return {
      ...base,
      ...(groupBy ? { groupBy: groupBy as WorkItemQuery['groupBy'] } : {}),
      filters: { ...base.filters, projectIds: [w.projectId], custom },
    };
  };

  const idsFrom = async (
    q: WorkItemQuery,
    fields: Map<string, CustomFieldKind>,
    groupKeys: string[] = ['all'],
  ) =>
    withActor(
      actor(),
      async (tx) => {
        const groups = await fetchWorkItemGroups(tx, q, { groupKeys, today: TODAY, fields });
        return groups.flatMap((group) => group.rows.map((row) => row.title));
      },
      h.app,
    );

  it('filters text by what it contains, escaping LIKE metacharacters', async () => {
    const { fieldId } = await defineField('text');
    const fields = new Map<string, CustomFieldKind>([[fieldId, 'text']]);

    const acme = await makeItem('has-acme');
    const percent = await makeItem('has-percent');
    await makeItem('has-nothing-text');

    await writeValue({ workItemId: acme, fieldId, kind: 'text', valueText: 'Acme Ltd' });
    await writeValue({ workItemId: percent, fieldId, kind: 'text', valueText: '50% Co' });

    const q = query([{ fieldId, op: 'has', text: 'acme' }]);
    expect(await idsFrom({ ...q, groupBy: 'none' }, fields)).toEqual(['has-acme']);

    // Unescaped, `%` is LIKE's wildcard and this search would return every item
    // that has any text at all. Escaped, it is a character somebody typed — so
    // it finds the one client whose name contains it, and nothing else.
    const wildcard = query([{ fieldId, op: 'has', text: '%' }]);
    expect(await idsFrom({ ...wildcard, groupBy: 'none' }, fields)).toEqual(['has-percent']);

    // The same for `_`, which matches any single character unescaped and would
    // otherwise make a one-character search return the whole project.
    const underscore = query([{ fieldId, op: 'has', text: '_' }]);
    expect(await idsFrom({ ...underscore, groupBy: 'none' }, fields)).toEqual([]);
  });

  it('filters a number and a date by range, open at either end', async () => {
    const number = await defineField('number');
    const date = await defineField('date');
    const fields = new Map<string, CustomFieldKind>([
      [number.fieldId, 'number'],
      [date.fieldId, 'date'],
    ]);

    const small = await makeItem('n-small');
    const large = await makeItem('n-large');
    await writeValue({ workItemId: small, fieldId: number.fieldId, kind: 'number', valueNumber: '10.5' });
    await writeValue({ workItemId: large, fieldId: number.fieldId, kind: 'number', valueNumber: '99' });

    const early = await makeItem('d-early');
    await writeValue({
      workItemId: early,
      fieldId: date.fieldId,
      kind: 'date',
      valueDate: '2026-01-01',
    });

    expect(
      await idsFrom({ ...query([{ fieldId: number.fieldId, op: 'range', from: '20', to: null }]), groupBy: 'none' }, fields),
    ).toEqual(['n-large']);

    expect(
      await idsFrom({ ...query([{ fieldId: number.fieldId, op: 'range', from: null, to: '20' }]), groupBy: 'none' }, fields),
    ).toEqual(['n-small']);

    expect(
      await idsFrom(
        { ...query([{ fieldId: date.fieldId, op: 'range', from: '2025-12-31', to: '2026-01-02' }]), groupBy: 'none' },
        fields,
      ),
    ).toEqual(['d-early']);
  });

  it('treats an unticked checkbox as the absence of a row', async () => {
    const { fieldId } = await defineField('checkbox');
    const fields = new Map<string, CustomFieldKind>([[fieldId, 'checkbox']]);

    const ticked = await makeItem('cb-ticked');
    await makeItem('cb-untouched');
    await writeValue({ workItemId: ticked, fieldId, kind: 'checkbox', valueCheckbox: true });

    expect(await idsFrom({ ...query([{ fieldId, op: 'is', value: true }]), groupBy: 'none' }, fields)).toEqual([
      'cb-ticked',
    ]);

    // The item nobody touched answers "not ticked", with no backfill — which is
    // the property that makes adding a field to an existing project free.
    const notTicked = await idsFrom(
      { ...query([{ fieldId, op: 'is', value: false }]), groupBy: 'none' },
      fields,
    );
    expect(notTicked).toContain('cb-untouched');
    expect(notTicked).not.toContain('cb-ticked');
  });

  it('matches any of several options, and offers the no-value bucket', async () => {
    const { fieldId, optionIds } = await defineField('multi_select', ['A', 'B', 'C']);
    const [a, b] = optionIds as [string, string];
    const fields = new Map<string, CustomFieldKind>([[fieldId, 'multi_select']]);

    const hasA = await makeItem('opt-a');
    const hasB = await makeItem('opt-b');
    await makeItem('opt-none');
    await writeValue({ workItemId: hasA, fieldId, kind: 'multi_select', valueOptionIds: [a] });
    await writeValue({ workItemId: hasB, fieldId, kind: 'multi_select', valueOptionIds: [b] });

    expect(
      (await idsFrom({ ...query([{ fieldId, op: 'in', ids: [a] }]), groupBy: 'none' }, fields)).sort(),
    ).toEqual(['opt-a']);

    // `none` OR-ed with the ids rather than filtered separately — the same rule
    // the assignee filter follows, because "unset or A" is a real question.
    const withNone = await idsFrom(
      { ...query([{ fieldId, op: 'in', ids: [a, NONE] }]), groupBy: 'none' },
      fields,
    );
    expect(withNone).toContain('opt-a');
    expect(withNone).toContain('opt-none');
    expect(withNone).not.toContain('opt-b');
  });

  it('answers "has any value" and "has none"', async () => {
    const { fieldId } = await defineField('text');
    const fields = new Map<string, CustomFieldKind>([[fieldId, 'text']]);

    const filled = await makeItem('set-filled');
    await makeItem('set-blank');
    await writeValue({ workItemId: filled, fieldId, kind: 'text', valueText: 'x' });

    expect(await idsFrom({ ...query([{ fieldId, op: 'set', value: true }]), groupBy: 'none' }, fields)).toEqual([
      'set-filled',
    ]);

    const unset = await idsFrom({ ...query([{ fieldId, op: 'set', value: false }]), groupBy: 'none' }, fields);
    expect(unset).toContain('set-blank');
    expect(unset).not.toContain('set-filled');
  });

  it('refuses to widen a list when the field is unknown to the builder', async () => {
    // A filter that cannot be evaluated must never silently match everything.
    // The service drops unknown fields before this point; if one ever arrives,
    // the builder returns nothing rather than everything.
    await makeItem('unknown-field-guard');
    const stranger = uuidv7();
    const rows = await idsFrom(
      { ...query([{ fieldId: stranger, op: 'set', value: true }]), groupBy: 'none' },
      new Map(),
    );
    expect(rows).toEqual([]);
  });
});

describe('grouping by a custom field', () => {
  it('counts an item under every option it holds, and the rest under `none`', async () => {
    const { fieldId, optionIds } = await defineField('multi_select', ['A', 'B']);
    const [a, b] = optionIds as [string, string];

    const both = await makeItem('group-both');
    await makeItem('group-none');
    await writeValue({ workItemId: both, fieldId, kind: 'multi_select', valueOptionIds: [a, b] });

    const base = emptyQuery();
    const q: WorkItemQuery = {
      ...base,
      groupBy: customGroupBy(fieldId) as WorkItemQuery['groupBy'],
      filters: { ...base.filters, projectIds: [w.projectId] },
    };

    const groups = await withActor(
      actor(),
      (tx) =>
        fetchWorkItemGroups(tx, q, {
          groupKeys: [a, b, NONE],
          today: TODAY,
          fields: new Map<string, CustomFieldKind>([[fieldId, 'multi_select']]),
        }),
      h.app,
    );

    const byKey = new Map(groups.map((group) => [group.key, group]));
    // A multi-select item belongs in both columns, which is what the LATERAL
    // fan-out in the counts query exists to produce.
    expect(byKey.get(a)?.rows.map((row) => row.title)).toEqual(['group-both']);
    expect(byKey.get(b)?.rows.map((row) => row.title)).toEqual(['group-both']);
    expect(byKey.get(a)?.total).toBe(1);
    expect(byKey.get(NONE)?.rows.map((row) => row.title)).toContain('group-none');
  });

  it('splits a checkbox into ticked and not, with no `none` bucket', async () => {
    const { fieldId } = await defineField('checkbox');
    const ticked = await makeItem('cbg-ticked');
    await makeItem('cbg-untouched');
    await writeValue({ workItemId: ticked, fieldId, kind: 'checkbox', valueCheckbox: true });

    const base = emptyQuery();
    const q: WorkItemQuery = {
      ...base,
      groupBy: customGroupBy(fieldId) as WorkItemQuery['groupBy'],
      filters: { ...base.filters, projectIds: [w.projectId] },
    };

    const groups = await withActor(
      actor(),
      (tx) =>
        fetchWorkItemGroups(tx, q, {
          groupKeys: ['true', 'false'],
          today: TODAY,
          fields: new Map<string, CustomFieldKind>([[fieldId, 'checkbox']]),
        }),
      h.app,
    );

    const byKey = new Map(groups.map((group) => [group.key, group]));
    expect(byKey.get('true')?.rows.map((row) => row.title)).toEqual(['cbg-ticked']);
    expect(byKey.get('false')?.rows.map((row) => row.title)).toContain('cbg-untouched');
    // Every item without a value counts as `false`, so the two buckets cover
    // the project between them.
    expect((byKey.get('true')?.total ?? 0) + (byKey.get('false')?.total ?? 0)).toBeGreaterThan(1);
  });
});

describe('a view-as session', () => {
  it('cannot define a field or write a value', async () => {
    const { fieldId } = await defineField('text');
    const item = await makeItem('read-only');

    const readOnly = { ...actor(), readOnly: true };

    // §7.13 is enforced at the database as well as in the policy module: every
    // tenant table's INSERT policy carries `and not tenancy.is_read_only()`.
    const definition = await failureOf(
      withActor(
        readOnly,
        (tx) =>
          tx.insert(customField).values({
            id: uuidv7(),
            workspaceId: w.workspaceId,
            projectId: w.projectId,
            name: 'while viewing as',
            kind: 'text',
          }),
        h.app,
      ),
    );
    expect(definition.code).toBe(SQLSTATE.insufficientPrivilege);

    const value = await failureOf(
      withActor(
        readOnly,
        (tx) =>
          tx.insert(customFieldValue).values({
            id: uuidv7(),
            workspaceId: w.workspaceId,
            workItemId: item,
            fieldId,
            kind: 'text',
            valueText: 'x',
          }),
        h.app,
      ),
    );
    expect(value.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('the value index the text filter rides', () => {
  it('exists, is a trigram index, and is partial', async () => {
    // §16 names "custom fields slow the list query" as a risk; an unanchored
    // ILIKE is the one filter no btree can serve, so the index is the answer
    // and its absence would be a silent sequential scan.
    const rows = await h.owner.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes
      where tablename = 'custom_field_value' and indexname = 'custom_field_value_text_trgm_idx'
    `);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.indexdef).toMatch(/gin/i);
    expect(rows.rows[0]?.indexdef).toMatch(/gin_trgm_ops/i);
    expect(rows.rows[0]?.indexdef).toMatch(/WHERE/i);
  });
});
