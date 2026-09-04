-- Slice 15 hardening: what drizzle-kit cannot express, and the bounds that keep
-- §6's "no setting can put a workspace in an unrecoverable state" true.
--
-- One new table, so one `FORCE ROW LEVEL SECURITY` line. Everything else here
-- is a CHECK on `workspace` or `workspace_holiday`, both of which have carried
-- policies since slice 1 and slice 9 respectively -- `invariants.test.ts` is the
-- gate that says so rather than this comment.

-- --- The new table ---------------------------------------------------------
-- Every tenant table is FORCE rather than merely ENABLE, because the owner role
-- owns it and RLS does not apply to a table's owner without this.
ALTER TABLE "workspace_notification_default" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The settings that could break the product (§6) -------------------------
-- §6's governing rule has a second half that is easy to miss: "No setting can
-- put a workspace in an unrecoverable state." Three of the columns slice 15
-- adds, plus the one slice 9 left unbounded, are the places that rule can be
-- broken from a settings form -- and the reason each bound is here rather than
-- only in the service is the reason slice 5 put `root_id` in 0008, slice 10 the
-- value CHECK in 0018, slice 11 the period bounds in 0020 and slice 13 the
-- availability pairing in 0024: a row written by a seed script, a CSV importer
-- or a Phase 2 MCP tool has to be as correct as one the service wrote.

-- A week starts on one of seven days, numbered as `working_days` numbers them:
-- 0 = Monday through 6 = Sunday. Not JavaScript's numbering, deliberately -- see
-- the column comment; two day-numbering schemes in one schema is how a calendar
-- ends up one column out of step with the mask that shades it.
ALTER TABLE "workspace"
  ADD CONSTRAINT "workspace_week_start_range"
  CHECK ("week_start" BETWEEN 0 AND 6);--> statement-breakpoint

-- **A company that works no days at all is the one setting that bricks a
-- workspace.** `next_working_day` walks forward looking for a day the mask
-- allows and finds none; `business_days_between` returns zero for every range,
-- so a cycle's ideal line is undefined and the burndown draws nothing; the
-- evening digest never fires, because there is no working evening. None of that
-- reports an error -- the product simply stops saying anything about time, which
-- is the failure mode §6 rules out by name.
--
-- The upper bound is the seven bits themselves: 127 is every day. Anything above
-- it is a bug in whatever wrote the row rather than a preference, and a mask
-- with an eighth bit set would silently be a working week nothing can display.
ALTER TABLE "workspace"
  ADD CONSTRAINT "workspace_working_days_range"
  CHECK ("working_days" BETWEEN 1 AND 127);--> statement-breakpoint

-- A locale code, not a sentence and not empty. Deliberately **not** an
-- enumeration of the locales the product ships: that set is a fact about
-- `src/i18n/routing.ts`, and a CHECK listing it would have to be migrated in
-- step with adding a language -- which is exactly the retrofit §13 calls the most
-- expensive available mistake. The service validates against the routing config;
-- this is the backstop that stops a row holding an essay.
ALTER TABLE "workspace"
  ADD CONSTRAINT "workspace_default_locale_shape"
  CHECK ("default_locale" ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$');--> statement-breakpoint

-- A holiday has a name somebody can read. Slice 9 created the table for the
-- digest to consult and nothing wrote to it, so an empty name was unreachable;
-- slice 15 gives it a form, and a blank row on the calendar screen is a day off
-- that says nothing about why.
--
-- Capped in characters rather than graphemes, like the availability reason in
-- 0024 and for the same reason: characters are the only unit SQL has. The
-- service caps by grapheme (§13), and this is loose enough underneath it that
-- the grapheme cap is always the one a person meets.
ALTER TABLE "workspace_holiday"
  ADD CONSTRAINT "workspace_holiday_name_present"
  CHECK (btrim("name") <> '' AND char_length("name") <= 200);--> statement-breakpoint

-- --- The logo is not an attachment, and its key is not a URL ----------------
-- §6-7's logo is an object key in the same store slice 8's attachments use, and
-- the column deliberately holds a **key**: slice 8 learned the hard way that
-- neither the app's configured base URL nor `request.url` is a reliable origin,
-- and a URL frozen into a row is that mistake made permanent -- a workspace
-- seeded on a laptop against the local driver would carry `localhost` into
-- production. The shape is asserted so a URL cannot be stored by accident.
ALTER TABLE "workspace"
  ADD CONSTRAINT "workspace_logo_key_shape"
  CHECK ("logo_key" IS NULL OR ("logo_key" !~ '^[a-z][a-z0-9+.-]*://' AND char_length("logo_key") BETWEEN 1 AND 400));
