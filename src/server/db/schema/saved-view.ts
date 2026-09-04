import { foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { project } from './project';
import { workspace, workspaceMember } from './workspace';

/**
 * Saved views (§4, §14 slice 12) — a name for a query somebody wanted again.
 *
 * One table, and the shape of it is three decisions.
 *
 * **The query is stored as a query string.** §5 already makes a URL the whole
 * of a view's state, so this column is that URL's search part and nothing else.
 * A parsed filter object here would be a second schema for what the Zod DSL
 * already defines, kept in step by hand — and the first slice to add a filter
 * would invalidate every row written before it. A stored query string is
 * re-parsed by `parseWorkItemQuery`, which discards what it does not understand
 * (§9), so a view saved by an older build still opens.
 *
 * **A view belongs to a member, not to a project or a workspace.** §4 lists
 * "saved view sharing with teammates" as a should-have, which means v1's are
 * personal; every read is keyed on the acting member's own id, underneath the
 * RLS that has already scoped the row to the workspace. Sharing is a later
 * `visibility` column and the §10 question that comes with it — not something
 * to leave half-built here.
 *
 * **`project_id` is nullable, and that is not the same as sharing.** A view
 * saved on a project's list belongs to that project and appears on its bar; a
 * null is reserved for the workspace-wide surfaces §14's slice 13 brings (My
 * Work, Needs Attention), which are the other place a person wants a filter
 * back. Nullable now rather than added later, for the reason slice 5 gave for
 * `rank` and `completed_at`: adding a column to a table already holding a
 * workspace's rows is a backfill under a lock, and adding it now costs one
 * column.
 */
export const savedView = pgTable(
  'saved_view',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * Whose view this is. Every query in `queries/saved-views.ts` carries this
     * in its predicate — the same construction the notification inbox uses, and
     * the reason neither needed a §10 row.
     */
    ownerMemberId: uuid('owner_member_id').notNull(),

    /** Null for a workspace-wide surface; a project id for a project's list. */
    projectId: uuid('project_id'),

    /** User content — never translated, never a key (§13). "Overdue, mine". */
    name: text('name').notNull(),

    /**
     * The URL's search part, without the leading `?`. Bounded by
     * `MAX_VIEW_QUERY_LENGTH`; the service checks it and this column is `text`
     * rather than `varchar(n)` because a length in two places is a length that
     * eventually disagrees, and the one that matters is the one a person sees
     * an error from.
     */
    query: text('query').notNull(),

    /**
     * §12's "column widths persisted per saved view", plus which columns are
     * shown and in what order.
     *
     * `jsonb` and not real columns, which is the opposite of the call §9 made
     * for custom field *values* — and the difference is the whole reason that
     * call was right. A custom field value is filtered, grouped and sorted by,
     * so it needs a typed indexed column. A column layout is read exactly once,
     * by the one component that draws the table, and is never a predicate. It
     * is a blob because it genuinely is one.
     *
     * Parsed through `parseTableLayout`, which drops what it does not
     * recognise, so nothing here is trusted on read.
     */
    layout: jsonb('layout'),

    ...timestamps,
  },
  (t) => [
    /**
     * Two of a person's own views called "This week" is a picker they cannot
     * use. Scoped to the owner rather than the workspace: two people naming
     * their own view the same thing is normal and not a collision.
     */
    unique('saved_view_owner_name_key').on(t.ownerMemberId, t.name),

    foreignKey({
      name: 'saved_view_owner_fk',
      columns: [t.ownerMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),

    /**
     * §9's composite-key device again: a view's project must be in the view's
     * workspace. `cascade` because a view of a deleted project describes
     * nothing — unlike a cycle, which holds items and therefore refuses.
     */
    foreignKey({
      name: 'saved_view_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /** The one read there is: this person's views, on this screen. */
    index('saved_view_owner_idx').on(t.ownerMemberId, t.projectId),

    ...tenantPolicies(),
  ],
);
