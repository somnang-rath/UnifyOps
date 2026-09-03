-- =============================================================================
-- Slice 8 hardening: FORCE RLS on `attachment`.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010 and 0012. Every table in
-- this schema is owned by unifyops_owner, and a table owner is exempt from its
-- own row-level security unless the table FORCEs it — so ENABLE alone (which
-- drizzle-kit emits) would leave the migration role able to read every
-- workspace's files, and invariants.test.ts fails any table in `public` that is
-- missing this line.
--
-- Nothing to revoke, for the reason 0012 gives about `comment`: an attachment
-- is ordinary tenant data. A person uploaded it, may remove it, and §10 lets a
-- Lead remove somebody else's — so it takes all five `tenantPolicies()` and the
-- default privileges bootstrap.sql grants are exactly right for it. `activity`
-- needed a REVOKE because it is a projection that must stay append-only; this
-- is not one.
--
-- No grants to unifyops_identity. Its grant list is asserted exactly by
-- invariants.test.ts, so the omission is checked rather than trusted — and a
-- file on a work item is as far from the pre-workspace handshake as anything in
-- the schema gets.
--
-- No owner "provisioning" policy. Nothing seeds attachments.
--
-- One constraint drizzle-kit cannot express, and it is the reason this file has
-- more than one statement. A `ready` attachment is one whose bytes are in the
-- store, and every screen reads it as such; a row that is `ready` while still
-- soft-deleted, or that names a comment it was never linked to, would be a file
-- the product disagrees with itself about. The check states the two shapes a
-- row may take — pending and unlinked, or ready — so an importer, a seed script
-- or a Phase 2 MCP tool cannot write a third. Slice 5 put its three invariants
-- in the database for exactly this reason (0008).
-- =============================================================================

ALTER TABLE "attachment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- A pending row has never been linked to a comment: linking happens in the same
-- statement that marks it ready (`markAttachmentsReady`).
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_pending_unlinked"
  CHECK ("status" <> 'pending' OR "comment_id" IS NULL);--> statement-breakpoint

-- The size the row claims is the size the ticket signed, and both are bounded
-- by MAX_ATTACHMENT_BYTES (25 MiB) in src/lib/attachments.ts. Stated here as
-- well, because the column is what every later reader trusts.
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_size_bounded"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400);
