CREATE TYPE "public"."label_color" AS ENUM('ink', 'sky', 'navy', 'lilac', 'chartreuse', 'warning', 'success', 'danger');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('urgent', 'high', 'medium', 'low', 'none');--> statement-breakpoint
CREATE TABLE "label" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" "label_color" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "label_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "label_workspace_name_key" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_counter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_counter_project_key" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state_id" uuid NOT NULL,
	"priority" "priority" DEFAULT 'none' NOT NULL,
	"parent_id" uuid,
	"root_id" uuid NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"rank" text NOT NULL,
	"start_date" date,
	"due_date" date,
	"estimate" integer,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"completed_at" timestamp with time zone,
	"assignee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"label_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_item_project_number_key" UNIQUE("project_id","number"),
	CONSTRAINT "work_item_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "work_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_item_assignee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"workspace_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_assignee_key" UNIQUE("work_item_id","workspace_member_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_item_label" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_label_key" UNIQUE("work_item_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "timezone" text DEFAULT 'Asia/Phnom_Penh' NOT NULL;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_counter" ADD CONSTRAINT "project_counter_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_counter" ADD CONSTRAINT "project_counter_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."project"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."project"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_state_fk" FOREIGN KEY ("state_id","workspace_id") REFERENCES "public"."workflow_state"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."work_item"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_creator_fk" FOREIGN KEY ("created_by_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignee" ADD CONSTRAINT "work_item_assignee_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignee" ADD CONSTRAINT "work_item_assignee_item_fk" FOREIGN KEY ("work_item_id","workspace_id") REFERENCES "public"."work_item"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignee" ADD CONSTRAINT "work_item_assignee_member_fk" FOREIGN KEY ("workspace_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_item_fk" FOREIGN KEY ("work_item_id","workspace_id") REFERENCES "public"."work_item"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_label_fk" FOREIGN KEY ("label_id","workspace_id") REFERENCES "public"."label"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_project_state_rank_idx" ON "work_item" USING btree ("project_id","state_id","rank");--> statement-breakpoint
CREATE INDEX "work_item_project_updated_idx" ON "work_item" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "work_item_workspace_due_idx" ON "work_item" USING btree ("workspace_id","due_date");--> statement-breakpoint
CREATE INDEX "work_item_root_idx" ON "work_item" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "work_item_parent_idx" ON "work_item" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "work_item_assignees_idx" ON "work_item" USING gin ("assignee_ids");--> statement-breakpoint
CREATE INDEX "work_item_labels_idx" ON "work_item" USING gin ("label_ids");--> statement-breakpoint
CREATE INDEX "work_item_assignee_member_idx" ON "work_item_assignee" USING btree ("workspace_member_id");--> statement-breakpoint
CREATE INDEX "work_item_label_label_idx" ON "work_item_label" USING btree ("label_id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "label" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "label" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "label" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "label" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "label" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "project_counter" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "project_counter" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "project_counter" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "project_counter" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "project_counter" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "work_item" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "work_item" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "work_item" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "work_item" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "work_item" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "work_item_assignee" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "work_item_assignee" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "work_item_assignee" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "work_item_assignee" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "work_item_assignee" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "work_item_label" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "work_item_label" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "work_item_label" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "work_item_label" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "work_item_label" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);