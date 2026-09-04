CREATE TABLE "cycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cycle_project_name_key" UNIQUE("project_id","name"),
	CONSTRAINT "cycle_id_project_workspace_key" UNIQUE("id","project_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "cycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."project"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_project_start_idx" ON "cycle" USING btree ("project_id","start_date");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_cycle_fk" FOREIGN KEY ("cycle_id","project_id","workspace_id") REFERENCES "public"."cycle"("id","project_id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_cycle_idx" ON "work_item" USING btree ("cycle_id") WHERE "work_item"."cycle_id" is not null;--> statement-breakpoint
CREATE POLICY "tenant_select" ON "cycle" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "cycle" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "cycle" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "cycle" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "cycle" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);