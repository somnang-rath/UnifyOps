CREATE TABLE "note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"work_item_id" uuid,
	"promoted_work_item_id" uuid,
	"search_text" text GENERATED ALWAYS AS (btrim(lower(translate(coalesce(title, '') || ' ' || body, U&'\200B\200C\200D\FEFF', '')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_promoted_work_item_id_work_item_id_fk" FOREIGN KEY ("promoted_work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_owner_fk" FOREIGN KEY ("owner_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_owner_idx" ON "note" USING btree ("owner_member_id","created_at","id");--> statement-breakpoint
CREATE INDEX "note_item_idx" ON "note" USING btree ("work_item_id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "note" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "note" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "note" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "note" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "note" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);