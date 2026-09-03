import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { WORKSPACE_ROLES } from '@/server/authz/roles';
import {
  appRole,
  identityRole,
  operatorRole,
  primaryId,
  tenantPolicies,
  timestamps,
  workspaceIdColumn,
} from './_shared';
import { user } from './user';

/**
 * §10. Closed enum, mapped to labels in code — no translation key in the database.
 *
 * The values come from the policy module so the database and the permission
 * matrix cannot drift apart; src/server/authz/roles.ts is the source of truth.
 */
export const workspaceRole = pgEnum('workspace_role', WORKSPACE_ROLES);

/**
 * A company. The tenant root: `workspace.id` is what every other tenant row
 * denormalizes as `workspace_id`.
 */
export const workspace = pgTable(
  'workspace',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),

    /**
     * The company's timezone (§6-1), and the authority for every date the
     * product asserts something about.
     *
     * Here in slice 5 rather than with the rest of company settings in slice 15,
     * because slice 5 is where "overdue" is first computed and §17-13 is
     * explicit about what happens without it: evaluated on the viewer's device,
     * an item is late for the employee and on time for their manager, and a
     * shared number becomes an argument. The column is the decision; the
     * settings screen that edits it is slice 15's.
     *
     * An IANA name, defaulted to the market §2.5 describes. Validated in the
     * service against `Intl.supportedValuesOf('timeZone')` rather than by a
     * check constraint — the tz database changes without the schema.
     */
    timezone: text('timezone').notNull().default('Asia/Phnom_Penh'),

    /**
     * Which days of the week the company works (§6-1, §9, §17-18).
     *
     * A seven-bit mask, bit 0 = Monday through bit 6 = Sunday. `0b0111111` = 63
     * is Monday–Saturday, which is the SEA default §2.5 describes, not the
     * Monday–Friday one a European default would have picked.
     *
     * Here in slice 9 rather than with the rest of company settings in slice 15,
     * for the reason `timezone` landed early in slice 5: §7.8's due-date digest
     * "moves to the last working evening before, so nobody is reminded on Sunday
     * about Monday", and a rule about working days needs to know which days
     * those are. The column is the decision; the settings screen is slice 15's.
     *
     * An integer mask rather than seven booleans or a day array because §9 puts
     * one SQL function — `business_days_between` — behind it, and a mask is what
     * that function can test with a single shift.
     */
    workingDays: integer('working_days').notNull().default(63),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workspace_slug_key').on(t.slug),

    /**
     * The tenant root keys on its own `id`, so it cannot use the shared
     * predicate. Pasting workspace B's URL while signed in as A must yield
     * zero rows here — which is what turns into the 404 that §15 requires
     * instead of an empty page.
     */
    pgPolicy('tenant_select', {
      for: 'select',
      to: appRole,
      using: sql`"workspace"."id" = tenancy.workspace_id()`,
    }),
    pgPolicy('tenant_update', {
      for: 'update',
      to: appRole,
      using: sql`"workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
      withCheck: sql`"workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
    }),
    /**
     * No INSERT or DELETE policy. A workspace cannot be created by a
     * connection that is already scoped to one — signup runs its own path
     * (slice 3) — and deleting a workspace is an owner operation that will
     * arrive with billing, not a row delete from a request.
     */
    /**
     * Creating a company is the other half of signup: it cannot happen on a
     * connection already scoped to a workspace, because there is not one yet.
     * INSERT and SELECT only — renaming or deleting a workspace is a §10 action
     * inside it, and goes through `withActor` like everything else.
     */
    pgPolicy('identity_insert', {
      for: 'insert',
      to: identityRole,
      withCheck: sql`true`,
    }),
    pgPolicy('identity_select', {
      for: 'select',
      to: identityRole,
      using: sql`true`,
    }),

    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);

/** Membership of a company, and the role that membership carries (§10). */
export const workspaceMember = pgTable(
  'workspace_member',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('member'),
    ...timestamps,
  },
  (t) => [
    unique('workspace_member_workspace_user_key').on(t.workspaceId, t.userId),
    /**
     * Redundant against the primary key on its own, but it is the target a
     * composite foreign key needs: a child row naming `(member_id,
     * workspace_id)` can then only match a member in the same workspace.
     */
    unique('workspace_member_id_workspace_key').on(t.id, t.workspaceId),
    index('workspace_member_user_idx').on(t.userId),
    ...tenantPolicies(),

    /**
     * The narrowest policy in the schema, and the one that keeps the identity
     * role honest.
     *
     * After sign-in the app has to answer "which workspaces is this person in?"
     * — a question that spans workspaces, so no single scope answers it. The
     * identity connection sets only `unifyops.user_id` and reads exactly the
     * rows for that user. It cannot see who else is in those workspaces, which
     * is the difference between a membership lookup and a tenant read.
     */
    pgPolicy('identity_select_own', {
      for: 'select',
      to: identityRole,
      using: sql`"workspace_member"."user_id" = tenancy.user_id()`,
    }),
  ],
);

/**
 * The company's public holidays (§6-1, §17-18).
 *
 * §17-18 is the finding this table answers, and it is specific to the market
 * §2.5 describes: Cambodia's closures are multi-day and lunar-dated — Khmer New
 * Year, Pchum Ben, Water Festival — so a product that only knows about weekends
 * fires every time-based surface at a whole workspace on the morning everyone
 * comes back, and trains people to ignore it.
 *
 * Per workspace and editable, not a shared table of national holidays, because
 * §6's customization rules put the calendar in the company's hands: a factory
 * and a bank do not close on the same days, and neither of them wants to file a
 * ticket with us to say so. §18-10 — who maintains the seed — is still open,
 * and is about where the *first* year's rows come from, not about this shape.
 *
 * A date rather than a range: multi-day closures are several rows. Ranges would
 * need overlap handling in every query that asks "is this day off", and the
 * question is asked far more often than the rows are written.
 */
export const workspaceHoliday = pgTable(
  'workspace_holiday',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /** The day off, in the workspace's own timezone. No time, no zone (§17-13). */
    date: date('date').notNull(),

    /**
     * What it is called. A literal, and deliberately **not** a `name_key` the
     * way seeded workflow states and teams carry one (§13, `src/lib/seeded-name.ts`).
     *
     * The seeded-name mechanism exists for rows the product invents and a
     * company may rename — "Done", "Engineering". A holiday is the opposite: it
     * arrives named in the company's own language, from a calendar we do not
     * own, and there is no English default that would be right to fall back to.
     * A workspace working in Khmer writes ចូលឆ្នាំខ្មែរ here and that is the name.
     */
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    /**
     * One row per day. A company cannot close twice on the same date, and the
     * upsert the settings screen will use (slice 15) needs a conflict target.
     */
    unique('workspace_holiday_date_key').on(t.workspaceId, t.date),

    /** `business_days_between` scans a range of dates for one workspace. */
    index('workspace_holiday_range_idx').on(t.workspaceId, t.date),

    ...tenantPolicies(),
  ],
);
