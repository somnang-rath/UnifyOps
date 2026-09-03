-- =============================================================================
-- Slice 7 hardening: FORCE RLS on `activity`, and the revokes that make it
-- append-only in privileges as well as in policy.
--
-- The same first job as 0002, 0004, 0006 and 0008, and the same absences for
-- the same reasons:
--
--   * No grants to unifyops_app or unifyops_operator. bootstrap.sql's default
--     privileges already gave the app role CRUD and the operator SELECT on
--     every table the owner creates — and half the point of this file is to
--     take two of the app's four back. The operator's default is SELECT and
--     nothing else, so there is nothing to revoke on that side.
--
--   * No grants to unifyops_identity. A work item's history is the furthest
--     thing there is from the moment before a workspace is known.
--     invariants.test.ts asserts that role's grant list exactly, so the
--     omission is checked rather than trusted.
--
--   * No owner "provisioning" policy. Activity is written by `withActor` on the
--     app role, inside the transaction that caused it, and by nothing else.
--
-- 0009 carries one thing that is not about this table: `app_user`'s
-- `user_select` policy no longer requires the membership to be live. The
-- comment on the policy in src/server/db/schema/user.ts is the explanation —
-- §7.12 keeps a departed member's history "preserved and attributed", and a
-- name nobody in the workspace may read is not attribution.
-- =============================================================================

ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- Append-only, enforced twice ---------------------------------------------
-- `activity` has no UPDATE and no DELETE policy, which under RLS already denies
-- both to every application role. This is the other half, and it is the half
-- that still holds if a policy is ever added carelessly: the privilege is not
-- there to be exercised.
--
-- The same belt-and-braces `audit_record` gets in 0002, for a related but not
-- identical reason. Audit must be unfalsifiable because it is evidence.
-- Activity must be append-only because it is a *projection*: a row here is the
-- consequence of an event that already happened, and editing the consequence
-- without the cause leaves the two sinks describing different histories of the
-- same transaction.
--
-- Deleting is likewise not a supported operation. Activity follows its item —
-- the composite foreign key onto work_item cascades — and §4's delete is a soft
-- delete anyway, so an item's history outlives its 30-day recovery window.

REVOKE UPDATE, DELETE, TRUNCATE ON "activity" FROM unifyops_app;
