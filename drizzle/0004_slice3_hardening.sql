-- =============================================================================
-- Slice 3 hardening: FORCE RLS on the new tables, and the identity role's
-- table list.
--
-- Same three jobs as 0002, for the tables slice 3 adds. The third one is new
-- and is the point of this file: unifyops_identity is granted a short, explicit
-- list of tables by name, and nothing else. bootstrap.sql deliberately gives it
-- no default privileges, so a tenant table added in slice 5 is out of its reach
-- by construction rather than by anyone remembering to revoke.
--
-- A NOTE THAT SUPERSEDES 0002. That file's comment says signup creates
-- app_user and workspace "as the owner". It no longer does, and must not: the
-- owner owns every table and can drop any of them, so putting its credential in
-- the web process would undo the reason the owner/app split exists at all. The
-- provisioning policies 0002 created stay, because `pnpm db:seed` still runs as
-- the owner — but the running application never holds that connection. The
-- runtime path is unifyops_identity, below.
-- =============================================================================

-- --- 1. FORCE ROW LEVEL SECURITY ---------------------------------------------
-- ENABLE alone exempts the table owner from its own policies. Every table, no
-- exceptions — invariants.test.ts fails the build if one is missed.

ALTER TABLE "auth_credential" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_verification_token" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation_team" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- --- 2. The auth tables belong to the identity role alone ---------------------
--
-- bootstrap.sql's default privileges handed the app role full CRUD and the
-- operator SELECT on every table the owner creates, which is right for tenant
-- tables and wrong for these three. A support role that can read live session
-- tokens can become any user in the product; one that can read password hashes
-- can try to become them somewhere else as well. The app role has no business
-- here either — it never runs outside a workspace scope, and these tables are
-- read before any scope exists.
--
-- RLS cannot make this distinction: a session is found by its token hash, with
-- nothing known yet about who is asking. So the grant is the boundary, and
-- invariants.test.ts asserts it rather than trusting it.

REVOKE ALL ON "auth_credential" FROM unifyops_app, unifyops_operator;
--> statement-breakpoint
REVOKE ALL ON "auth_session" FROM unifyops_app, unifyops_operator;
--> statement-breakpoint
REVOKE ALL ON "auth_verification_token" FROM unifyops_app, unifyops_operator;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_credential" TO unifyops_identity;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_session" TO unifyops_identity;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_verification_token" TO unifyops_identity;
--> statement-breakpoint

-- --- 3. The identity role's reach into the tenant tables ----------------------
--
-- Four tables, each for one named moment, and the privilege is the smallest one
-- that moment needs:
--
--   app_user          sign in (find by email), sign up (create), verify (update)
--   workspace         sign up (create the company), and read the one an
--                     invitation names so the accept screen can say who invited
--   workspace_member  SELECT only, and the policy narrows it further to rows
--                     belonging to the already-authenticated user — the
--                     "which workspaces am I in?" question no single scope can
--                     answer
--   invitation        SELECT only: exchange a token for the workspace it names.
--                     Creating, revoking and accepting are workspace actions
--                     behind §10 manage_members, and run through withActor.
--
-- Note what is absent: team, team_member, audit_record, invitation_team, and
-- every table a later slice adds. The identity role cannot read one row of what
-- a company is actually doing.

GRANT SELECT, INSERT, UPDATE ON "app_user" TO unifyops_identity;
--> statement-breakpoint
GRANT SELECT, INSERT ON "workspace" TO unifyops_identity;
--> statement-breakpoint
GRANT SELECT ON "workspace_member" TO unifyops_identity;
--> statement-breakpoint
GRANT SELECT ON "invitation" TO unifyops_identity;
--> statement-breakpoint

-- The workspace_member policy calls tenancy.user_id(), so the role needs to
-- reach the schema and execute the function. It gets those two and no more:
-- workspace_id() and is_read_only() stay ungranted, because an identity
-- connection that could assert a workspace scope would be a tenant read
-- wearing a handshake's name.
GRANT USAGE ON SCHEMA tenancy TO unifyops_identity;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.user_id() TO unifyops_identity;
--> statement-breakpoint

-- --- 4. Invitations are tenant data ------------------------------------------
-- The operator keeps its cross-tenant SELECT here, unlike on the auth tables:
-- an invitation is a company's own record of who it asked to join, which is
-- exactly the kind of thing §18-12 support exists to look at.

GRANT SELECT ON "invitation" TO unifyops_operator;
--> statement-breakpoint
GRANT SELECT ON "invitation_team" TO unifyops_operator;
