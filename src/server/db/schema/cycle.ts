import {
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { project } from './project';
import { workspace } from './workspace';

/**
 * Cycles (§7.6, §14 slice 11) — "create with date range → add items → cycle
 * becomes active on start date → progress bar + burndown → on end date,
 * incomplete items prompt".
 *
 * One table, and one nullable column on `work_item`. That is the whole data
 * model, and each of the two shapes below is a decision worth stating.
 *
 * **There is no `status` column.** §7.6 says a cycle "becomes active on start
 * date", and the obvious reading of that is a stored status something flips.
 * Something would have to be a scheduled job, per cycle — created at cycle
 * creation, rescheduled whenever the dates are edited, and repaired after any
 * of that happened while the worker was down. A missed repair is a cycle that
 * silently never starts, which is the same failure mode slice 9 refused when it
 * made the digest one hourly tick rather than a schedule per workspace. Two
 * dates and today answer the question with nothing to go wrong, and
 * `cycleStatus` in `src/lib/cycles.ts` is the one place they are compared.
 *
 * **Membership is a column on the item, not a join table.** §7.6: "Cycle
 * membership is per item, never inherited" — an item is in at most one cycle,
 * which is a single-valued property and belongs on the row that has it. A join
 * table would permit two, and the first query that assumed otherwise would be
 * the burndown double-counting an item.
 */
export const cycle = pgTable(
  'cycle',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),

    /** User content — never translated, never a key (§13). "Sprint 14", "April". */
    name: text('name').notNull(),

    /**
     * What the team said they were going to do. Optional, and free text.
     *
     * §7.6 does not ask for it and one line of intent is what makes a burndown
     * legible three months later, when the item titles have all been renamed.
     */
    goal: text('goal'),

    /**
     * The range, as calendar dates — the same `mode: 'string'` every date in
     * this product uses, and for the same reason (§17-13): a timestamp would be
     * re-interpreted in whatever zone the server or the browser is in, and a
     * cycle would start on different days for two people in one meeting.
     * "Today" is always the **workspace's** today.
     */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),

    /**
     * When somebody answered §7.6's end-of-cycle prompt — **not** the status.
     *
     * The end date having passed and a human having decided what happens to the
     * work still open are two different facts, and the prompt has to keep
     * appearing until the second one is true. "Leave them where they are" is
     * one of §7.6's three answers and sets this exactly like the other two do:
     * a decision was made, and a prompt that reappears after it has been
     * dismissed is a prompt nobody ever finishes answering.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    /**
     * Two cycles called "Sprint 4" on one project is a picker nobody can use.
     * Scoped to the project rather than the workspace, because two teams
     * numbering their own sprints from 1 is normal and not a collision.
     */
    unique('cycle_project_name_key').on(t.projectId, t.name),

    /**
     * What `work_item.cycle_id`'s foreign key points at, and the reason it can
     * be a foreign key rather than a trigger.
     *
     * Carrying `project_id` in the key means an item's cycle must belong to the
     * item's *project*, not merely to its workspace — §9's composite-key device
     * ("a row physically cannot reference a parent in another workspace"),
     * pushed one level further down the hierarchy because here the tenant check
     * alone would still allow an item in Engineering to join Marketing's
     * sprint.
     */
    unique('cycle_id_project_workspace_key').on(t.id, t.projectId, t.workspaceId),

    foreignKey({
      name: 'cycle_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /** The cycles list, in date order, and the "which cycle is active" lookup. */
    index('cycle_project_start_idx').on(t.projectId, t.startDate),

    ...tenantPolicies(),
  ],
);
