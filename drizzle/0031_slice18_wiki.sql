CREATE TYPE "public"."wiki_space_kind" AS ENUM('company', 'project');--> statement-breakpoint
CREATE TABLE "wiki_page" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"root_id" uuid NOT NULL,
	"depth" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"search_text" text GENERATED ALWAYS AS (btrim(lower(translate(title || ' ' || coalesce(body, ''), U&'\200B\200C\200D\FEFF', '')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wiki_page_slug_key" UNIQUE("space_id","slug"),
	CONSTRAINT "wiki_page_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki_page_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wiki_page_link_key" UNIQUE("page_id","work_item_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_page_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki_page_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wiki_page_revision_no_key" UNIQUE("page_id","revision_no")
);
--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki_space" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "wiki_space_kind" NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"name_key" text,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wiki_space_slug_key" UNIQUE("workspace_id","slug"),
	CONSTRAINT "wiki_space_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "wiki_space_project_key" UNIQUE("workspace_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_space" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "work_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "work_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "wiki_page_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "wiki_page_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_message" ADD COLUMN "wiki_page_id" uuid;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "promoted_page_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_space_fk" FOREIGN KEY ("space_id","workspace_id") REFERENCES "public"."wiki_space"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_parent_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_link" ADD CONSTRAINT "wiki_page_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_link" ADD CONSTRAINT "wiki_page_link_page_fk" FOREIGN KEY ("page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_link" ADD CONSTRAINT "wiki_page_link_item_fk" FOREIGN KEY ("work_item_id","workspace_id") REFERENCES "public"."work_item"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_link" ADD CONSTRAINT "wiki_page_link_author_fk" FOREIGN KEY ("created_by_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_page_fk" FOREIGN KEY ("page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_author_fk" FOREIGN KEY ("author_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_space" ADD CONSTRAINT "wiki_space_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_space" ADD CONSTRAINT "wiki_space_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."project"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_page_space_idx" ON "wiki_page" USING btree ("space_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "wiki_page_root_idx" ON "wiki_page" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "wiki_page_link_item_idx" ON "wiki_page_link" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "wiki_page_revision_page_idx" ON "wiki_page_revision" USING btree ("page_id","revision_no");--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_page_fk" FOREIGN KEY ("wiki_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_page_fk" FOREIGN KEY ("wiki_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_message" ADD CONSTRAINT "outbox_page_fk" FOREIGN KEY ("wiki_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_promoted_page_fk" FOREIGN KEY ("promoted_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_page_idx" ON "attachment" USING btree ("wiki_page_id","created_at","id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_page" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_page" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "wiki_page" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "wiki_page" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_page" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_page_link" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_page_link" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "wiki_page_link" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "wiki_page_link" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_page_link" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_page_revision" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_page_revision" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_page_revision" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "wiki_space" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "wiki_space" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "wiki_space" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "wiki_space" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "wiki_space" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);