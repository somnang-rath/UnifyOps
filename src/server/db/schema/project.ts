import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { PROJECT_ROLES } from '@/server/authz/roles';
import { STATE_COLORS, STATE_GROUPS } from '@/lib/state-groups';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { team } from './team';
import { workspace, workspaceMember } from './workspace';

/**
 * §10. The three roles held *within* one project, independent of the workspace
 * role. Built from the policy module's constant for the same reason
 * `workspace_role` is: the database and the permission matrix cannot be allowed
 * to drift apart.
 */
export const projectRole = pgEnum('project_role', PROJECT_ROLES);

/**
 * Who can see the project at all (§10).
 *
 * `workspace` grants every Member an implicit Viewer; `private` grants nothing
 * to anyone who is not explicitly a member. The composition itself lives in the
 * policy module — this column is only the fact it composes over.
 */
export const projectVisibility = pgEnum('project_visibility', ['workspace', 'private']);

/** §4. The five ordered groups every workflow state belongs to. */
export const stateGroup = pgEnum('state_group', STATE_GROUPS);

/** §12. The closed set a state may be recoloured to — token names, never hex. */
export const stateColor = pgEnum('state_color', STATE_COLORS);

/**
 * A project: the unit work items live in, owned by a team (§9).
 */
export const project = pgTable(
  'project',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').notNull(),
    slug: text('slug').notNull(),

    /**
     * The prefix of every human identifier in this project — the `ENG` in
     * `ENG-142` (§9).
     *
     * Deliberately not editable after creation and never reused: the moment one
     * item has been pasted into a chat message, the prefix is part of a public
     * name for that work. §4 makes the same rule for the numbers.
     */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    visibility: projectVisibility('visibility').notNull().default('workspace'),

    /**
     * User-facing, reversible, and **not** the same thing as `deleted_at`
     * (§9). An archived project is read-only until it is unarchived — which is
     * one click — so this column is read by every mutation in the project, not
     * only by the list that hides it.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('project_workspace_slug_key').on(t.workspaceId, t.slug),
    unique('project_workspace_key_key').on(t.workspaceId, t.key),
    /** The target a child's composite foreign key needs (§9). */
    unique('project_id_workspace_key').on(t.id, t.workspaceId),
    index('project_team_idx').on(t.teamId),
    foreignKey({
      name: 'project_team_fk',
      columns: [t.teamId, t.workspaceId],
      foreignColumns: [team.id, team.workspaceId],
    }).onDelete('restrict'),
    ...tenantPolicies(),
  ],
);

/**
 * Explicit membership of a project, and the role it carries (§10).
 *
 * Explicit only. Owner and Admin are implicit Leads everywhere and a
 * workspace-visible project grants Members an implicit Viewer — neither is ever
 * written here, because composing them in one place (`effectiveProjectRole`) is
 * what keeps the rule single-implementation. A row here is somebody who was
 * *added*.
 */
export const projectMember = pgTable(
  'project_member',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    workspaceMemberId: uuid('workspace_member_id').notNull(),
    role: projectRole('role').notNull().default('member'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'project_member_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_member_member_fk',
      columns: [t.workspaceMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),
    unique('project_member_project_member_key').on(t.projectId, t.workspaceMemberId),
    index('project_member_member_idx').on(t.workspaceMemberId),
    ...tenantPolicies(),
  ],
);

/**
 * A column on the board, and a row in project settings (§6-3).
 *
 * Two name columns, which looks like one too many until you have shipped a
 * seeded default in two languages. A state this product created carries
 * `name_key` and renders translated — a Khmer workspace sees ដំណើរការ, not "In
 * Progress". The moment a person renames it, the key clears and the literal
 * they typed wins for good. That is the whole mechanism: no translation key
 * ever reaches the database for a *closed* enum (`group` below is one), and a
 * seeded default is the one open-ended value allowed to carry one (§13).
 */
export const workflowState = pgTable(
  'workflow_state',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),

    /** The literal name. For a seeded state this is the English fallback. */
    name: text('name').notNull(),
    /** `defaultState.inProgress` while seeded; NULL forever after a rename. */
    nameKey: text('name_key'),

    group: stateGroup('group').notNull(),
    color: stateColor('color').notNull(),

    /**
     * Order within the project. A plain integer, rewritten as a block when
     * states are reordered — deliberately not the fractional index work items
     * use (§9). That machinery exists because two people drag cards on the same
     * board at the same time; a project has six states and reordering them is a
     * settings action taken by one Lead at a time.
     */
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'workflow_state_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),
    /** The target slice 5's work_item needs, so an item cannot borrow another workspace's state. */
    unique('workflow_state_id_workspace_key').on(t.id, t.workspaceId),
    unique('workflow_state_project_name_key').on(t.projectId, t.name),
    index('workflow_state_project_position_idx').on(t.projectId, t.position),
    ...tenantPolicies(),
  ],
);
