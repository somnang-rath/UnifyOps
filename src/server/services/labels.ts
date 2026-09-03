import 'server-only';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { label, workItemLabel } from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';
import { defaultLabelColor, isLabelColor, type LabelColor } from '@/lib/label-colors';

/**
 * Labels — the company's own vocabulary for its work (§4).
 *
 * **Who may manage them is `workspace.settings`, not a new §10 row.** The
 * permission matrix has no label line, and inventing one would put a rule in
 * the code that the document a non-technical owner is shown does not contain —
 * which is the failure §10 is written to prevent. A label is workspace
 * configuration in the same sense a team is, so it takes the same permission:
 * Owner and Admin.
 *
 * *Applying* an existing label to an item is a different question and takes a
 * different answer — `work_item.edit`, in `work-items.ts`. Anyone who can edit
 * an item can tag it; only an Owner or Admin decides what tags exist. That
 * split is what keeps a fifty-person workspace from accumulating four spellings
 * of "urgent".
 */

export type LabelRow = {
  id: string;
  name: string;
  color: LabelColor;
};

export type LabelProblem = 'name_required' | 'name_taken' | 'not_found' | 'in_use';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: LabelProblem };

export async function readLabels(tx: TenantDb): Promise<LabelRow[]> {
  return tx
    .select({ id: label.id, name: label.name, color: label.color })
    .from(label)
    .where(isNull(label.deletedAt))
    .orderBy(asc(label.name));
}

export async function listLabels(context: ActorContext): Promise<LabelRow[]> {
  return withActor(context, async (tx) => readLabels(tx));
}

/** The labels a page of work items referenced, for the chips it has to draw. */
export async function readLabelsByIds(
  tx: TenantDb,
  ids: readonly string[],
): Promise<LabelRow[]> {
  if (ids.length === 0) return [];

  return tx
    .select({ id: label.id, name: label.name, color: label.color })
    .from(label)
    .where(and(inArray(label.id, [...ids]), isNull(label.deletedAt)))
    .orderBy(asc(label.name));
}

export async function createLabel(
  resolved: ResolvedActor,
  input: { name: string; color?: string },
): Promise<Ok<{ labelId: string }> | Failed> {
  assertCan(resolved.actor, 'workspace.settings');

  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };

  const color = isLabelColor(input.color) ? input.color : defaultLabelColor(name);
  const labelId = uuidv7();

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      await tx.insert(label).values({
        id: labelId,
        workspaceId: resolved.workspace.id,
        name,
        color,
      });

      uow.emit({
        type: 'label.created',
        workspaceId: resolved.workspace.id,
        labelId,
        name,
        color,
      });

      return { ok: true, labelId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

export async function updateLabel(
  resolved: ResolvedActor,
  input: { labelId: string; name?: string; color?: string },
): Promise<Ok | Failed> {
  assertCan(resolved.actor, 'workspace.settings');

  const name = input.name?.trim().normalize('NFC');
  if (name !== undefined && !name) return { ok: false, problem: 'name_required' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const rows = await tx
        .select({ id: label.id, name: label.name, color: label.color })
        .from(label)
        .where(and(eq(label.id, input.labelId), isNull(label.deletedAt)))
        .limit(1);

      const current = rows[0];
      if (!current) return { ok: false, problem: 'not_found' } as const;

      const nextName = name ?? current.name;
      const nextColor = isLabelColor(input.color) ? input.color : current.color;
      if (nextName === current.name && nextColor === current.color) return { ok: true } as const;

      await tx
        .update(label)
        .set({ name: nextName, color: nextColor, updatedAt: new Date() })
        .where(eq(label.id, input.labelId));

      uow.emit({
        type: 'label.updated',
        workspaceId: resolved.workspace.id,
        labelId: input.labelId,
        name: nextName,
        color: nextColor,
        previousName: nextName === current.name ? null : current.name,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Deleting a label.
 *
 * Soft, unlike a workflow state — and the difference is the §6 safety rule that
 * "deleting a definition with data requires an explicit choice about the data".
 * A state holding items forces a migration target because the items cannot
 * exist without a state; a label is an annotation, so removing it from the
 * items that carry it *is* the choice, and it is made explicitly by passing
 * `detach`. Without it, a label still in use is refused and the caller is told
 * how many items would be affected.
 */
export async function deleteLabel(
  resolved: ResolvedActor,
  input: { labelId: string; detach?: boolean },
): Promise<Ok | Failed> {
  assertCan(resolved.actor, 'workspace.settings');

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ id: label.id, name: label.name })
      .from(label)
      .where(and(eq(label.id, input.labelId), isNull(label.deletedAt)))
      .limit(1);

    const current = rows[0];
    if (!current) return { ok: false, problem: 'not_found' } as const;

    const attached = await tx
      .select({ id: workItemLabel.id })
      .from(workItemLabel)
      .where(eq(workItemLabel.labelId, input.labelId));

    if (attached.length > 0 && !input.detach) {
      return { ok: false, problem: 'in_use' } as const;
    }

    // Hard-deleted from the join, so the trigger rewrites every affected item's
    // `label_ids` and the GIN index stops pointing at a label nobody can see.
    if (attached.length > 0) {
      await tx.delete(workItemLabel).where(eq(workItemLabel.labelId, input.labelId));
    }

    await tx
      .update(label)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(label.id, input.labelId));

    uow.emit({
      type: 'label.deleted',
      workspaceId: resolved.workspace.id,
      labelId: input.labelId,
      name: current.name,
      detachedFrom: attached.length,
    });

    return { ok: true } as const;
  });
}
