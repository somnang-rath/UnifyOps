CREATE TYPE "public"."accent_color" AS ENUM('navy', 'sky', 'lilac', 'chartreuse');--> statement-breakpoint
CREATE TABLE "workspace_notification_default" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"channels" "notification_channel"[] DEFAULT '{}'::notification_channel[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_notification_default_key" UNIQUE("workspace_id","kind")
);
--> statement-breakpoint
ALTER TABLE "workspace_notification_default" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "week_start" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "default_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "accent" "accent_color";--> statement-breakpoint
ALTER TABLE "workspace_notification_default" ADD CONSTRAINT "workspace_notification_default_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_select" ON "workspace_notification_default" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "workspace_notification_default" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "workspace_notification_default" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "workspace_notification_default" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "workspace_notification_default" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);