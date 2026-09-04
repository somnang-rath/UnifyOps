CREATE TYPE "public"."custom_field_kind" AS ENUM('text', 'number', 'select', 'multi_select', 'date', 'user', 'checkbox');--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "custom_field_kind" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "custom_field_project_name_key" UNIQUE("project_id","name"),
	CONSTRAINT "custom_field_id_workspace_kind_key" UNIQUE("id","workspace_id","kind"),
	CONSTRAINT "custom_field_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "custom_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_field_option" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "custom_field_option_field_name_key" UNIQUE("field_id","name")
);
--> statement-breakpoint
ALTER TABLE "custom_field_option" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"kind" "custom_field_kind" NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_date" date,
	"value_checkbox" boolean,
	"value_option_ids" uuid[],
	"value_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_value_item_field_key" UNIQUE("work_item_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "custom_field_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."project"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_field_fk" FOREIGN KEY ("field_id","workspace_id") REFERENCES "public"."custom_field"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_item_fk" FOREIGN KEY ("work_item_id","workspace_id") REFERENCES "public"."work_item"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_field_fk" FOREIGN KEY ("field_id","workspace_id","kind") REFERENCES "public"."custom_field"("id","workspace_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_member_fk" FOREIGN KEY ("value_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_project_idx" ON "custom_field" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "custom_field_option_field_idx" ON "custom_field_option" USING btree ("field_id","position");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_text_idx" ON "custom_field_value" USING btree ("field_id","value_text");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_number_idx" ON "custom_field_value" USING btree ("field_id","value_number");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_date_idx" ON "custom_field_value" USING btree ("field_id","value_date");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_checkbox_idx" ON "custom_field_value" USING btree ("field_id","value_checkbox");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_member_idx" ON "custom_field_value" USING btree ("field_id","value_member_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_options_idx" ON "custom_field_value" USING gin ("value_option_ids");--> statement-breakpoint
CREATE INDEX "custom_field_value_field_idx" ON "custom_field_value" USING btree ("field_id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "custom_field" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "custom_field" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "custom_field" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "custom_field" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "custom_field" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "custom_field_option" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "custom_field_option" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "custom_field_option" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "custom_field_option" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "custom_field_option" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "custom_field_value" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "custom_field_value" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "custom_field_value" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "custom_field_value" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "custom_field_value" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);