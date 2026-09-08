-- Slice 21 hardening — what drizzle-kit cannot express (§21.6, §21.12).
--
-- 0037 loosened two NOT NULLs on `comment` and added a third subject column.
-- §21.6 weighs that trade in as many words: "Loosening two NOT NULLs on the
-- second-busiest table in the schema is the cost, and the CHECK is what pays it
-- back — the constraint that replaces them refuses more than they did, because
-- it also refuses a row belonging to both."
--
-- This is 0032's construction for `attachment`, applied to the same shape of
-- problem one slice later. It lives here rather than in the service for the
-- reason slice 5 put `root_id` in 0008, slice 10 the value CHECK in 0018 and
-- slice 11 the period bounds in 0020: a row written by a seed script, a CSV
-- importer or a Phase 2 MCP tool has to be as correct as one the service wrote.
--
-- No new table, so no `FORCE ROW LEVEL SECURITY` line and no grants: `comment`
-- has carried both since slice 8, and widening a column does not touch either.

-- --- §21.6: one comment table, two possible subjects -------------------------
-- `num_nonnulls`, the device 0018 introduced for custom field values and 0032
-- reused for the attachment and notification unions.
ALTER TABLE "comment"
  ADD CONSTRAINT "comment_one_subject"
  CHECK (num_nonnulls("work_item_id", "wiki_page_id") = 1);--> statement-breakpoint

-- The project is denormalized from the item so a permission check does not need
-- a join (slice 8), so it is present exactly when the item is. A page's
-- permission question is asked of its **space** (§20.5) and a page in the
-- company space has no project at all — so a page-owned row carrying a
-- project_id would be a row inviting the wrong check.
--
-- Written as an equality of `num_nonnulls` rather than as two implications,
-- because that is the form 0032 already uses for `attachment_project_with_item`
-- and one form for one rule is worth more than a marginally shorter predicate.
ALTER TABLE "comment"
  ADD CONSTRAINT "comment_project_with_item"
  CHECK (num_nonnulls("project_id") = num_nonnulls("work_item_id"));--> statement-breakpoint

-- --- The constraint slice 21 had to *remove*, and why ------------------------
-- 0032 wrote:
--
--     ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_with_item"
--       CHECK ("comment_id" IS NULL OR "work_item_id" IS NOT NULL);
--
-- with the comment "a page has no comments in v1 (§20.16 leaves open whether it
-- ever gets them), so a comment deep-link only makes sense on the item branch."
-- §21.6 is the answer to that open question, and it is yes — so a mention in a
-- page comment produces exactly the row this constraint refuses: a `wiki_page_id`
-- subject with a `comment_id` deep link.
--
-- It is dropped rather than rewritten. What it was protecting is already held by
-- `notification_one_subject` beside it — exactly one subject — and "a comment
-- id belongs to whichever subject the comment is on" is not a fact this table
-- can check without a join, which is precisely what a CHECK may not do. The
-- `comment` table's own `comment_one_subject` above is where that correspondence
-- is enforced, one level down and on the row that actually knows.
ALTER TABLE "notification" DROP CONSTRAINT "notification_comment_with_item";--> statement-breakpoint

-- The outbox's `outbox_one_subject` is untouched: it was already written as
-- *at most one* rather than *exactly one*, and it never carried a companion
-- constraint tying `comment_id` to the item branch, so nothing there had to
-- change.
--
-- To be exact about what this constraint had and had not broken: slice 18's page
-- *mention* carries no comment id, so it never violated the constraint dropped
-- above. It never got that far either — `deliverNotification` dropped every
-- page-subject message before any row was attempted, which slice 21 found and
-- fixed in `src/server/jobs/notify.ts`. A page *comment* is the first row that
-- would have met this constraint, and it would have met it as a foreign-key-shaped
-- refusal in a background worker: the loudest possible failure in the quietest
-- possible place.
