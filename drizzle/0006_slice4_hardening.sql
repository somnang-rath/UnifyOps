-- =============================================================================
-- Slice 4 hardening: FORCE RLS on the tables 0005 adds.
--
-- Same first job as 0002 and 0004, for projects, project membership and
-- workflow states. Nothing else belongs here, and the absences are the point:
--
--   * No grants to unifyops_app or unifyops_operator. bootstrap.sql's default
--     privileges already gave the app role CRUD and the operator SELECT on
--     every table the owner creates, which is exactly right for tenant tables.
--
--   * No grants to unifyops_identity, and this is deliberate rather than
--     forgotten. The handshake role exists for the moment before a workspace is
--     known — sign in, sign up, exchange an invitation token — and a project is
--     the first thing that says what a company is *doing*. bootstrap.sql gives
--     that role no default privileges precisely so a slice like this one has to
--     opt in by name; this slice does not, and invariants.test.ts asserts the
--     grant list exactly, so the omission is checked rather than trusted.
--
--   * No owner "provisioning" policy. 0002 gave those to `workspace` and
--     `app_user` only, because they are the two rows nothing inside a tenant
--     scope can create. A project is created by a member of the workspace it
--     belongs to, so it goes through withActor on the app role like every other
--     tenant row — including in `pnpm db:seed`.
-- =============================================================================

-- --- FORCE ROW LEVEL SECURITY ------------------------------------------------
-- ENABLE alone exempts the table owner from its own policies, and the owner is
-- what migrations and drizzle-kit run as. FORCE is the half that survives
-- someone running a script with the wrong connection string.

ALTER TABLE "project" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_state" FORCE ROW LEVEL SECURITY;
