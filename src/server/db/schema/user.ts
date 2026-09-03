import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { appRole, identityRole, operatorRole, primaryId, timestamps } from './_shared';

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
    /**
     * Null until the address is confirmed (§7.1). Deliberately a timestamp and
     * not a boolean: "when" is the question support actually asks, and a
     * boolean would have to be widened to answer it later.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('app_user_email_key').on(sql`lower(${t.email})`),

    /**
     * A user row is visible only to workspaces the user actually belongs to —
     * or belonged to. Without this the app role could enumerate every account
     * in the product, a tenancy leak in a table that has no `workspace_id` of
     * its own to key on.
     *
     * Membership is *not* filtered on `deleted_at`, and slice 7 is where that
     * stopped being a detail. §7.12 offboards a member by soft-deleting the
     * membership and keeping "their comments and activity history preserved and
     * **attributed**" — which the narrower predicate quietly made impossible:
     * their name became unreadable the moment they left, and every screen that
     * had recorded their work would have shown it done by nobody.
     *
     * The scope this policy exists to enforce is unchanged. A row is reachable
     * only from a workspace the person actually joined; what widened is time,
     * not tenancy. Every caller that means *current* members says so already —
     * `listMembers` filters `workspace_member.deleted_at` itself, which is the
     * right place for it, because that question is about membership rather than
     * about who is allowed to read a name.
     */
    pgPolicy('user_select', {
      for: 'select',
      to: appRole,
      using: sql`exists (
        select 1 from workspace_member wm
        where wm.user_id = "app_user"."id"
          and wm.workspace_id = tenancy.workspace_id()
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

    /**
     * The identity role owns this table's pre-tenancy half (slice 3).
     *
     * Signing in means finding an account by email with no workspace in hand,
     * which the app-role policy above correctly refuses. Creating one, and
     * marking an address verified, are the same moment. Everything after the
     * handshake reads `app_user` through the membership-scoped policy instead.
     */
    pgPolicy('identity_manage', {
      for: 'all',
      to: identityRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),

    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);
