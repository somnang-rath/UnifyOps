-- =============================================================================
-- Slice 20 hardening: FORCE RLS on the derived reference table, the CHECK that
-- keeps a derived edge from pointing at itself, and the floor under a page icon.
--
-- The same first job as every even-numbered migration since 0002: every table
-- here is owned by unifyops_owner, and a table owner is exempt from its own
-- row-level security unless the table FORCEs it. drizzle-kit emits ENABLE and
-- nothing else, so without this line the migration role could read across every
-- workspace — and invariants.test.ts fails any table in `public` that is missing
-- one.
-- =============================================================================

ALTER TABLE "wiki_page_ref" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- A page does not link to itself -----------------------------------------
-- `#[its own id]` in a body is legal text and parses like any other token, so
-- without this a page would appear in its own "what links here" — which reads as
-- a bug in the backlink feature rather than as a quirk of one body.
--
-- `syncPageRefs` drops the self-reference before it inserts anything, so this
-- constraint should never fire from the service. It is here for the reason slice
-- 5 put `root_id` in 0008, slice 10 the value CHECK in 0018, slice 11 the date
-- range in 0020, slice 15 the working-day bound in 0028, slice 18 the page
-- invariants in 0032 and slice 19 the verification pair in 0034: a row written
-- by a seed script, §21.8's Markdown importer or a Phase 2 MCP tool has to be as
-- correct as one written by the service.
ALTER TABLE "wiki_page_ref"
  ADD CONSTRAINT "wiki_page_ref_not_self"
  CHECK ("from_page_id" <> "to_page_id");--> statement-breakpoint

-- --- A page icon is an icon --------------------------------------------------
-- §21.2 puts the page icon in this slice, and `wiki_page.icon` is a `text`
-- column holding one emoji — text the writer's own keyboard produces, rather
-- than a name resolving to a component (a second vocabulary to build, translate
-- and explain) or an upload (a second `attachment` shape for a 16px square).
--
-- **This CHECK is a floor and not the rule.** The rule is one *grapheme*, and a
-- grapheme is what `Intl.Segmenter` counts in `normalizePageIcon` — a flag is
-- two code points and a skin-toned emoji three or four, all of which render as
-- one character, so counting code points would refuse icons that fit. That is
-- §13's arithmetic and Postgres cannot do it: there is no grapheme segmentation
-- in core, and adding an extension to bound one decorative column would be a
-- deployment dependency taken for a cosmetic field.
--
-- So the database refuses what is obviously not an icon — an empty string, a
-- newline, a space, a paragraph — and the service refuses what only a segmenter
-- can see. 16 code points is longer than any single emoji ZWJ sequence in
-- Unicode 15 and shorter than any sentence anybody would paste.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_icon_shape"
  CHECK (
    "icon" IS NULL
    OR (char_length("icon") BETWEEN 1 AND 16 AND "icon" !~ '\s')
  );
