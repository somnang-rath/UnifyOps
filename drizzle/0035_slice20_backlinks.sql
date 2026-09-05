CREATE TABLE "wiki_page_ref" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_page_id" uuid NOT NULL,
	"to_page_id" uuid NOT NULL,
	CONSTRAINT "wiki_page_ref_key" UNIQUE("from_page_id","to_page_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_page_ref" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "wiki_page_ref" ADD CONSTRAINT "wiki_page_ref_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_ref" ADD CONSTRAINT "wiki_page_ref_from_fk" FOREIGN KEY ("from_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_ref" ADD CONSTRAINT "wiki_page_ref_to_fk" FOREIGN KEY ("to_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_page_ref_to_idx" ON "wiki_page_ref" USING btree ("to_page_id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_page_ref" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_page_ref" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "wiki_page_ref" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "wiki_page_ref" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_page_ref" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);