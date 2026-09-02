import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { appRole, operatorRole, primaryId, timestamps } from './_shared';

/**
 * A person. Global, not tenant-scoped: one human can belong to several
 * workspaces, which is the point of a multi-company product.
 *
 * The SQL name is `app_user` rather than `user`, which is reserved and would
 * need quoting in every hand-written policy and migration in the tenancy
 * layer. The TypeScript export stays `user`.
 */
export const user = pgTable(
  'app_user',
  {
    id: primaryId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    /**
     * A BCP-47 code, not a translation key — closed enums and locale codes are
     * data; translated strings never reach the database (§13).
     */
    locale: text('locale').notNull().default('en'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('app_user_email_key').on(sql`lower(${t.email})`),

    /**
     * A user row is visible only to workspaces the user actually belongs to.
     * Without this the app role could enumerate every account in the product
     * — a tenancy leak in a table that has no `workspace_id` of its own to
     * key on.
     */
    pgPolicy('user_select', {
      for: 'select',
      to: appRole,
      using: sql`exists (
        select 1 from workspace_member wm
        where wm.user_id = "app_user"."id"
          and wm.workspace_id = tenancy.workspace_id()
          and wm.deleted_at is null
      )`,
    }),

    /**
     * A user may update their own row and nothing else. There is no INSERT or
     * DELETE policy: accounts are created and removed by the auth flow through
     * the owner-side path, not by an ordinary request.
     */
    pgPolicy('user_update_self', {
      for: 'update',
      to: appRole,
      using: sql`"app_user"."id" = tenancy.user_id() and not tenancy.is_read_only()`,
      withCheck: sql`"app_user"."id" = tenancy.user_id() and not tenancy.is_read_only()`,
    }),

    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);
