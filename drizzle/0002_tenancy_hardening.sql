-- =============================================================================
-- Hardening that drizzle-kit does not express.
--
-- 1. FORCE ROW LEVEL SECURITY.  ENABLE alone exempts the table owner from its
--    own policies. The app connects as a non-owner so ENABLE would be enough
--    today — FORCE is what keeps it enough on the day someone runs a script,
--    a migration, or a console session as the owner and expects the policies
--    to hold. §9 calls the two-role split the foundation; this is the half of
--    it that lives in SQL.
--
-- 2. Table privileges that match the policies.  RLS filters rows; it does not
--    remove a command the role was granted. Append-only on audit_record is
--    enforced twice: no UPDATE/DELETE policy (RLS denies), and no UPDATE/DELETE
--    privilege (the grant system denies). An admin editing the record of their
--    own role change must fail both ways.
--
-- 3. The operator role gets SELECT and nothing else, on every table (§18-12).
--    Cross-tenant read only; anything that must act inside a workspace goes
--    through an invited account plus view-as, which is audited.
-- =============================================================================

ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_record" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Append-only. Belt and braces, and both are load-bearing: a future migration
-- that adds an UPDATE policy by copy-paste still cannot update, and a future
-- GRANT still meets no policy.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_record" FROM unifyops_app;
--> statement-breakpoint

-- Rows are created by the auth flow, not by a scoped request; the policies say
-- so and the privileges agree.
REVOKE INSERT, DELETE ON "app_user" FROM unifyops_app;
--> statement-breakpoint
REVOKE INSERT, DELETE ON "workspace" FROM unifyops_app;
--> statement-breakpoint

-- Provisioning. FORCE means the owner is subject to policies too, and no tenant
-- table gives the owner one — so the owner connection cannot read or write a
-- single tenant row, which is stronger than §9 asks for and worth keeping.
--
-- The two root tables are the exception, because something has to be able to
-- create them: a workspace cannot be inserted by a connection already scoped to
-- a workspace, and an account exists before any membership does. Signup (slice
-- 3) creates these two rows as the owner and then opens a normal withActor on
-- the new workspace for everything else, so the tenant tables keep their single
-- write path.
--
-- Consequence worth knowing: `pg_dump` as the owner now dumps zero tenant rows.
-- Back up as a superuser.
CREATE POLICY "provisioning" ON "workspace" FOR ALL TO unifyops_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "provisioning" ON "app_user" FOR ALL TO unifyops_owner USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Operator: cross-tenant SELECT, and only SELECT, on everything.
GRANT SELECT ON "app_user" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "workspace" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "workspace_member" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "team" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "team_member" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "audit_record" TO unifyops_operator;
