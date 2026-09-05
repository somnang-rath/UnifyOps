CREATE TABLE "wiki_page_label" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_label_key" UNIQUE("page_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_page_label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "owner_member_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "verified_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "verification_expires_at" date;--> statement-breakpoint
ALTER TABLE "wiki_space" ADD COLUMN "default_verification_days" integer;--> statement-breakpoint
ALTER TABLE "wiki_page_label" ADD CONSTRAINT "wiki_page_label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_label" ADD CONSTRAINT "wiki_page_label_page_fk" FOREIGN KEY ("page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_label" ADD CONSTRAINT "wiki_page_label_label_fk" FOREIGN KEY ("label_id","workspace_id") REFERENCES "public"."label"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_page_label_label_idx" ON "wiki_page_label" USING btree ("label_id");--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_owner_fk" FOREIGN KEY ("owner_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_verifier_fk" FOREIGN KEY ("verified_by_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_page_owner_idx" ON "wiki_page" USING btree ("owner_member_id","verification_expires_at") WHERE "wiki_page"."owner_member_id" is not null and "wiki_page"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "wiki_page_verification_idx" ON "wiki_page" USING btree ("space_id","verification_expires_at");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_page_label" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_page_label" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "wiki_page_label" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "wiki_page_label" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_page_label" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);