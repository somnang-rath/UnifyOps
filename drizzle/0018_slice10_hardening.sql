-- =============================================================================
-- Slice 10 hardening: FORCE RLS on the three custom-field tables, the CHECK
-- that makes a typed value row honest, the trigram index behind the text
-- filter, and the trigger that keeps an option's id out of a value once the
-- option is gone.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010, 0012, 0014 and 0016:
-- every table here is owned by unifyops_owner, and a table owner is exempt from
-- its own row-level security unless the table FORCEs it. drizzle-kit emits
-- ENABLE and nothing else, so without these lines the migration role could read
-- across every workspace — and invariants.test.ts fails any table in `public`
-- that is missing one.
-- =============================================================================

ALTER TABLE "custom_field" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_option" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_value" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- One kind, one column ----------------------------------------------------
-- §9 asks for "typed indexed columns per value kind", which is only true if a
-- row cannot populate the wrong one. The composite foreign key already pins
-- `kind` to the field's own kind; this is the other half — the kind decides
-- which column holds the value, and no row may set two.
--
-- In the database rather than in the service, for the reason slice 5 gave when
-- it put `root_id`, `depth` and the assignee arrays in migration 0008: a row
-- written by a seed script, a CSV importer or a Phase 2 MCP tool has to be as
-- correct as one written by `custom-fields.ts`, and a rule that lives only in
-- TypeScript is a rule those three do not have.
--
-- `num_nonnulls` counts the value columns that are set, so the first clause is
-- "exactly one", and the CASE says which. Two consequences worth stating:
--
--   * A checkbox row is always TRUE. An unticked box is the absence of the row
--     — which is also the correct answer for every item that existed before the
--     field was added, with no backfill.
--   * A single-select holds exactly one option and a multi-select at least one.
--     An empty array is not "no choice", it is a row that should not exist.

ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_kind_check" CHECK (
  num_nonnulls(value_text, value_number, value_date, value_checkbox, value_option_ids, value_member_id) = 1
  AND CASE kind
        WHEN 'text'         THEN value_text IS NOT NULL
        WHEN 'number'       THEN value_number IS NOT NULL
        WHEN 'date'         THEN value_date IS NOT NULL
        WHEN 'checkbox'     THEN value_checkbox
        WHEN 'user'         THEN value_member_id IS NOT NULL
        WHEN 'select'       THEN cardinality(value_option_ids) = 1
        WHEN 'multi_select' THEN cardinality(value_option_ids) >= 1
      END
);--> statement-breakpoint

-- --- The text filter's index -------------------------------------------------
-- The `has` operator is "contains", which is `ILIKE '%…%'` — a pattern no btree
-- index can serve, because it is unanchored. pg_trgm is already installed (it
-- carries Khmer search, §13), and a GIN trigram index answers exactly this
-- shape.
--
-- Partial, because a value row only exists where somebody entered one and only
-- text fields populate this column: the index is then the size of the text
-- values in the workspace rather than the size of every custom value in it.
--
-- §16 names "custom fields slow the list query" as a risk and answers it with
-- typed indexed columns. This is the one column where "typed" alone was not
-- enough.

CREATE INDEX "custom_field_value_text_trgm_idx"
  ON "custom_field_value" USING gin (value_text gin_trgm_ops)
  WHERE value_text IS NOT NULL;--> statement-breakpoint

-- --- Deleting an option cannot orphan a value --------------------------------
-- `value_option_ids` is a uuid[], and an array cannot carry a foreign key — the
-- same trade `work_item.assignee_ids` makes, and the same answer: the database
-- maintains it, not the application.
--
-- §6's customization safety rules say deleting a definition with data requires
-- an explicit choice about the data. The *choice* is the service's (it counts
-- the uses and refuses without a confirmation); carrying it out is here, so
-- that an option deleted by any other path still leaves no value pointing at a
-- row that no longer exists.
--
-- Order matters. A value naming only this option becomes an empty array, which
-- the CHECK above correctly refuses — so those rows are deleted first, and the
-- rest have the id stripped out. Both statements are scoped to the option's own
-- field, and RLS scopes them to its workspace: the trigger runs SECURITY
-- INVOKER (the default), so it can never touch another company's rows.

CREATE OR REPLACE FUNCTION clear_deleted_custom_field_option()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM custom_field_value
  WHERE field_id = OLD.field_id
    AND value_option_ids = ARRAY[OLD.id]::uuid[];

  UPDATE custom_field_value
  SET value_option_ids = array_remove(value_option_ids, OLD.id),
      updated_at = now()
  WHERE field_id = OLD.field_id
    AND OLD.id = ANY(value_option_ids);

  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER custom_field_option_cleared
AFTER DELETE ON "custom_field_option"
FOR EACH ROW
EXECUTE FUNCTION clear_deleted_custom_field_option();--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010, 0012 and 0016 give: the pre-tenancy handshake is the
-- moment before a workspace is known, and a custom field is as inside-a-company
-- as data gets. That role's grant list is asserted exactly in
-- invariants.test.ts, so this omission is checked rather than trusted.
