-- =============================================================================
-- Slice 18 hardening: FORCE RLS on the four wiki tables, the invariants a page
-- has to satisfy however it was written, the append-only revision history, the
-- CHECKs that pay for two loosened NOT NULLs, and §13's two-index search recipe
-- applied to a third corpus.
--
-- The same first job as every even-numbered migration since 0002: every table
-- here is owned by unifyops_owner, and a table owner is exempt from its own
-- row-level security unless the table FORCEs it. drizzle-kit emits ENABLE and
-- nothing else, so without these lines the migration role could read across
-- every workspace — and invariants.test.ts fails any table in `public` that is
-- missing one.
-- =============================================================================

ALTER TABLE "wiki_space" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_page" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_page_link" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- A space's kind and its project must agree -------------------------------
-- §20.4: "`project_id` nullable and non-null exactly when `kind = 'project'` (a
-- `num_nonnulls` CHECK — 0018's device)".
--
-- This is not tidiness. A project space with no project is a space nothing can
-- resolve a permission for — `canWriteSpace` asks §10 about the project and
-- there is none — and a company space *with* one is a space whose permission
-- answer depends on which column the reader happened to look at. §20.5 makes the
-- space the unit of access, so a space whose kind and parent disagree is a hole
-- in the access model rather than a malformed row.
ALTER TABLE "wiki_space"
  ADD CONSTRAINT "wiki_space_kind_project"
  CHECK (num_nonnulls("project_id") = (CASE WHEN "kind" = 'project' THEN 1 ELSE 0 END));--> statement-breakpoint

-- One company space per workspace (§20.2: "One **company space** per workspace,
-- seeded at signup; one space per project, created with the project. No other
-- kind").
--
-- A partial unique index rather than a table constraint, because the uniqueness
-- is conditional and drizzle-kit cannot express that in the schema. The project
-- half is already covered by `wiki_space_project_key`, which works because
-- Postgres does not treat two nulls as equal — exactly the behaviour wanted
-- there and exactly the behaviour that makes this second index necessary here.
CREATE UNIQUE INDEX "wiki_space_company_key"
  ON "wiki_space" ("workspace_id")
  WHERE "kind" = 'company' AND "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "wiki_space"
  ADD CONSTRAINT "wiki_space_name_present"
  CHECK (length(btrim("name")) > 0);--> statement-breakpoint

-- --- A page's title, body and revision number --------------------------------
-- `validatePage` in src/lib/wiki.ts checks the first two, and both are here
-- anyway, for the reason slice 5 put `root_id` in 0008, slice 10 the value CHECK
-- in 0018, slice 11 the date range in 0020 and slice 17 the note bounds in 0030:
-- a row written by a seed script, a Markdown importer or a Phase 2 MCP tool has
-- to be as correct as one written by the service.

-- **An empty body is allowed and an empty title is not**, which is the opposite
-- of a note (0030) and deliberate. §20.11: an empty page "reads as empty, not as
-- broken" — a page created as a placeholder for something somebody will write
-- next week is a real thing a wiki holds, and it is reachable in the sidebar by
-- its title. A note has no title field at all, so its body is the whole of it.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_title_present"
  CHECK (length(btrim("title")) > 0);--> statement-breakpoint

-- `MAX_PAGE_BODY_LENGTH`, in code points rather than in graphemes, and the gap
-- is the same deliberate one 0030 explains: the service counts graphemes because
-- that is the number a person experiences (§13), and Postgres has no grapheme
-- function without an extension we are not adding for a bound. So this is a
-- *ceiling above* the real cap — generous enough that no body the service would
-- accept can hit it, tight enough that no single row can be unbounded.
--
-- It matters more here than it did for a note, because §20.4 stores the **whole
-- body** in every revision rather than a diff. An unbounded body would make an
-- unbounded history.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_body_bounded"
  CHECK (length("body") <= 800000);--> statement-breakpoint

-- Revision numbers start at 1 and never go backwards. The conditional UPDATE in
-- `saveWikiPage` is what actually serialises concurrent saves (§20.3.3); this is
-- what makes a bug in that logic a failed transaction rather than a page that
-- silently claims to be older than it is.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_revision_positive"
  CHECK ("revision_no" >= 1);--> statement-breakpoint

ALTER TABLE "wiki_page_revision"
  ADD CONSTRAINT "wiki_page_revision_positive"
  CHECK ("revision_no" >= 1);--> statement-breakpoint

-- --- The tree: root_id, depth, and the cap of 3 ------------------------------
-- §20.4: "**`root_id`, `depth` and the cap of 3 live in the database**, for the
-- reason slice 5 put them there for work items… Three levels rather than more,
-- because a tree deeper than three is a tree nobody navigates — and the space is
-- effectively the fourth level, which is what makes three enough."
--
-- This is 0008's pair of triggers, adapted. Two differences from the work-item
-- version are worth naming, because both are consequences of the noun rather
-- than of style:
--
--   * **`depth` is 1-based here and 0-based there.** A page's depth is what the
--     sidebar indents by and what `MAX_PAGE_DEPTH` in src/lib/wiki.ts compares
--     against, and off-by-one between a constant and a column is the defect this
--     avoids. `wiki_page.depth` defaults to 1, so a root page is at depth 1 and
--     the cap is `> 3` rather than `> 2`.
--   * **A page cannot be re-parented across spaces by this trigger alone.** A
--     move between spaces changes who may read the page (§20.5), so the service
--     asks §10 about both spaces; what the trigger enforces is that the parent
--     is in the same space as the child, which is the structural half.
--
-- Deliberately not SECURITY DEFINER, for 0008's reason: the trigger reads
-- wiki_page as whoever is writing, under the same RLS policies. A parent in
-- another workspace is invisible, so re-parenting across a tenant boundary fails
-- as "parent not found" rather than succeeding.

CREATE OR REPLACE FUNCTION tenancy.wiki_page_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_root uuid;
  parent_depth integer;
  parent_space uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a wiki page cannot be its own parent'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT root_id, depth, space_id INTO parent_root, parent_depth, parent_space
  FROM public.wiki_page WHERE id = NEW.parent_id;

  IF parent_root IS NULL THEN
    RAISE EXCEPTION 'parent wiki page % not found', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A page's parent is in its own space, always. §20.5 makes the space the unit
  -- of access, so a child in a different space from its parent would be a page
  -- whose permissions and whose position in the tree disagreed — and the sidebar
  -- would show a page somebody may not open.
  IF parent_space <> NEW.space_id THEN
    RAISE EXCEPTION 'a wiki page and its parent must be in the same space'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A cycle is only reachable by re-parenting onto a descendant, so the check is
  -- needed on UPDATE alone — and the branch is nested rather than and-ed,
  -- because OLD is an unassigned record on INSERT and a single SQL expression
  -- mentioning it would fail there rather than short-circuit. 0008's note.
  IF TG_OP = 'UPDATE' THEN
    IF parent_root = OLD.root_id AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM public.wiki_page WHERE parent_id = OLD.id
        UNION ALL
        SELECT w.id FROM public.wiki_page w JOIN descendants d ON w.parent_id = d.id
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    ) THEN
      RAISE EXCEPTION 'a wiki page cannot be moved under its own descendant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.root_id := parent_root;
  NEW.depth := parent_depth + 1;

  IF NEW.depth > 3 THEN
    RAISE EXCEPTION 'wiki pages are capped at three levels within a space (§20.4)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER wiki_page_hierarchy_trg
BEFORE INSERT OR UPDATE OF parent_id, space_id ON "wiki_page"
FOR EACH ROW EXECUTE FUNCTION tenancy.wiki_page_hierarchy();--> statement-breakpoint

-- Re-parenting moves a whole subtree, so the descendants' root_id, depth and
-- space are rewritten after the row itself settles. Without this, moving a page
-- leaves its children claiming the old root — and "all descendants" silently
-- returns the wrong set, which is the failure a closure table was rejected to
-- avoid rather than to trade for (0008).
--
-- The space is carried down as well, which the work-item version has no
-- equivalent of: §20.5 makes the space the permission boundary, so a subtree
-- whose root moved to another space and whose children did not would be pages
-- readable through a space they are no longer in.

CREATE OR REPLACE FUNCTION tenancy.wiki_page_subtree_moved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  deepest integer;
BEGIN
  WITH RECURSIVE descendants AS (
    SELECT id, NEW.root_id AS root_id, NEW.depth + 1 AS depth
    FROM public.wiki_page WHERE parent_id = NEW.id
    UNION ALL
    SELECT w.id, d.root_id, d.depth + 1
    FROM public.wiki_page w JOIN descendants d ON w.parent_id = d.id
  )
  UPDATE public.wiki_page w
  SET root_id = d.root_id, depth = d.depth, space_id = NEW.space_id
  FROM descendants d
  WHERE w.id = d.id;

  SELECT max(depth) INTO deepest FROM public.wiki_page WHERE root_id = NEW.root_id;

  IF deepest > 3 THEN
    RAISE EXCEPTION 'that move would nest wiki pages more than three levels deep (§20.4)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER wiki_page_subtree_moved_trg
AFTER UPDATE OF parent_id, space_id ON "wiki_page"
FOR EACH ROW
WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.space_id IS DISTINCT FROM NEW.space_id)
EXECUTE FUNCTION tenancy.wiki_page_subtree_moved();--> statement-breakpoint

-- --- A revision that can be edited is not a history --------------------------
-- §20.4, in one sentence, and this is the half the policies could not express on
-- their own. `wiki_page_revision` writes its policies by hand in the schema —
-- SELECT and INSERT only, no UPDATE, no DELETE — joining `audit_record` and
-- `activity` as append-only. Revoking the privileges is the second layer: a
-- policy added carelessly in a later slice still cannot open the table, because
-- the app role does not hold the grant the policy would apply to.
--
-- This is 0009's construction for `activity` and 0002's for `audit_record`,
-- applied to the third and last append-only table in the product.
REVOKE UPDATE, DELETE ON TABLE "wiki_page_revision" FROM unifyops_app;--> statement-breakpoint

-- --- §20.9: one attachment table, two possible parents ------------------------
-- 0031 dropped NOT NULL from `attachment.work_item_id` and from
-- `attachment.project_id`, and added `wiki_page_id`. §20.9 weighs that trade
-- explicitly and this constraint is what pays it back: "Loosening the NOT NULL is
-- the cost, and the CHECK is what pays it back — the constraint that replaces it
-- is stricter than the one it removes, because it also refuses a row belonging to
-- both."
--
-- `num_nonnulls`, the device 0018 already uses for custom field values.
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_one_parent"
  CHECK (num_nonnulls("work_item_id", "wiki_page_id") = 1);--> statement-breakpoint

-- The project is denormalized from the item so a permission check does not need
-- a join (slice 8), so it is present exactly when the item is. A page's
-- permission question is asked of its **space** (§20.5) and a page in the
-- company space has no project at all — so a page-owned row with a project_id
-- would be a row inviting the wrong check.
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_project_with_item"
  CHECK (num_nonnulls("project_id") = num_nonnulls("work_item_id"));--> statement-breakpoint

-- A comment belongs to an item, so a file claiming both a comment and a page is
-- claiming two different conversations. The `attachment_one_parent` CHECK above
-- already refuses the page half; this refuses the remainder, which is a
-- page-owned file that also names a comment.
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_comment_with_item"
  CHECK ("comment_id" IS NULL OR "work_item_id" IS NOT NULL);--> statement-breakpoint

-- --- §20.6: the notification subject union -----------------------------------
-- "The field becomes a subject union… the notification row stores two nullable
-- columns under a CHECK that exactly one is set, and the inbox row and the
-- email's deep link read the subject rather than assuming it."
--
-- `notification.work_item_id` lost its NOT NULL in 0031 for this, and — as with
-- `attachment` above — what replaces it is stricter than what it replaced.
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_one_subject"
  CHECK (num_nonnulls("work_item_id", "wiki_page_id") = 1);--> statement-breakpoint

-- A page has no comments in v1 (§20.16 leaves open whether it ever gets them),
-- so a comment deep-link only makes sense on the item branch.
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_comment_with_item"
  CHECK ("comment_id" IS NULL OR "work_item_id" IS NOT NULL);--> statement-breakpoint

-- The outbox is the *at most one* case rather than *exactly one*: most events in
-- this product are about neither an item nor a page — a workspace rename, a team
-- created — and those rows have carried a null `work_item_id` since slice 9. What
-- must not happen is a row claiming both, because the worker would then have two
-- deep links and no rule for choosing.
ALTER TABLE "outbox_message"
  ADD CONSTRAINT "outbox_one_subject"
  CHECK (num_nonnulls("work_item_id", "wiki_page_id") <= 1);--> statement-breakpoint

-- --- §13's search, on a third corpus -----------------------------------------
-- The same two indexes 0026 created for `work_item` and 0030 for `note`, over
-- the same generated `search_text` column. §20.8: pages and notes "reuse
-- everything *above* the query" rather than inventing a second recipe —
-- `searchRoute`, `hasKhmer`, `toTsQuery`, `toLikePattern` and `MIN_QUERY_LENGTH`
-- stay the only place those decisions are made.
--
-- "One routing rule, three corpora. If each corpus detected script its own way,
-- a mixed-script query would find items and miss pages, and the bug report would
-- be a Khmer page nobody could find."

-- The Latin route. `simple` and not `english`, for 0026's reason: a stemmer
-- drops "no" and "off" as stopwords. The query must use this exact expression or
-- the planner will not reach for the index.
CREATE INDEX "wiki_page_search_fts_idx"
  ON "wiki_page" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint

-- The Khmer route. Khmer has no inter-word spaces, so `to_tsvector` sees one
-- enormous token and only that whole string could ever match it; a trigram
-- substring match is the one thing that finds a word inside it (§13). This
-- matters more for a page than for anything else in the product, because a page
-- is the longest continuous Khmer text a company writes (§20.10).
--
-- On the column rather than on an expression, because the predicate is
-- `search_text LIKE '%…%'` and `gin_trgm_ops` can only serve a LIKE against the
-- indexed value. The column is generated `lower(...)` precisely so this can be
-- LIKE rather than ILIKE.
CREATE INDEX "wiki_page_search_trgm_idx"
  ON "wiki_page" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

-- Only live pages are searched, and the partial index says so rather than the
-- query paying for it. A deleted page is recoverable for 30 days (§20.3.6) and
-- must not appear in a palette in the meantime — which is a different rule from
-- an *archived* item, where §17-17 makes the exclusion a toggle a person can
-- turn off.
CREATE INDEX "wiki_page_live_idx"
  ON "wiki_page" ("space_id", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010 through 0030 all give: the pre-tenancy handshake is the
-- moment before a workspace is known, and it has no business reading one word of
-- what a company has written down. That role's grant list is asserted *exactly*
-- in invariants.test.ts, so this omission is checked rather than trusted.
