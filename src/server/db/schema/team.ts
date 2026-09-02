import { foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { workspace, workspaceMember } from './workspace';

/** A team inside a company. Projects belong to teams (§9). */
export const team = pgTable(
  'team',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('team_workspace_slug_key').on(t.workspaceId, t.slug),
    unique('team_id_workspace_key').on(t.id, t.workspaceId),
    ...tenantPolicies(),
  ],
);

/**
 * Team membership — the first table with two tenant parents, and so the one
 * that demonstrates the §9 invariant: both foreign keys are composite, on
 * `(id, workspace_id)`, so a team in workspace A physically cannot be given a
 * member from workspace B. RLS would already hide the row; the constraint
 * means it cannot be written in the first place.
 */
export const teamMember = pgTable(
  'team_member',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').notNull(),
    workspaceMemberId: uuid('workspace_member_id').notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'team_member_team_fk',
      columns: [t.teamId, t.workspaceId],
      foreignColumns: [team.id, team.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'team_member_member_fk',
      columns: [t.workspaceMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),
    unique('team_member_team_member_key').on(t.teamId, t.workspaceMemberId),
    index('team_member_member_idx').on(t.workspaceMemberId),
    ...tenantPolicies(),
  ],
);
