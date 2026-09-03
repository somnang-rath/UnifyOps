-- =============================================================================
-- Slice 8 hardening: FORCE RLS on `comment` and `comment_mention`.
--
-- The same first job as 0002, 0004, 0006, 0008 and 0010. Every table in this
-- schema is owned by unifyops_owner, and a table owner is exempt from its own
-- row-level security unless the table FORCEs it — so ENABLE alone (which
-- drizzle-kit emits) would leave the migration role able to read across every
-- workspace, and invariants.test.ts fails any table in `public` that is missing
-- this line.
--
-- Unlike 0010, there is nothing to revoke. `activity` needed the REVOKE because
-- it is append-only and had to lose two of the app role's four privileges.
-- A comment is not a projection of anything: a person wrote it, may delete it,
-- and §10 lets a Lead delete somebody else's. It is ordinary tenant data, it
-- takes all five `tenantPolicies()`, and the default privileges bootstrap.sql
-- grants are exactly right for it.
--
-- No grants to unifyops_identity, for the reason 0010 gives: a conversation on
-- a work item is the furthest thing there is from the moment before a workspace
-- is known. That role's grant list is asserted exactly, so the omission is
-- checked rather than trusted.
--
-- No owner "provisioning" policy. Nothing seeds comments.
-- =============================================================================

ALTER TABLE "comment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comment_mention" FORCE ROW LEVEL SECURITY;
