CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_kind" AS ENUM('member', 'operator', 'system');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_member_workspace_user_key" UNIQUE("workspace_id","user_id"),
	CONSTRAINT "workspace_member_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_workspace_slug_key" UNIQUE("workspace_id","slug"),
	CONSTRAINT "team_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"workspace_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_member_team_member_key" UNIQUE("team_id","workspace_member_id")
);
--> statement-breakpoint
ALTER TABLE "team_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"on_behalf_of_user_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_member_fk" FOREIGN KEY ("workspace_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_on_behalf_of_user_id_app_user_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_member_member_idx" ON "team_member" USING btree ("workspace_member_id");--> statement-breakpoint
CREATE INDEX "audit_record_workspace_occurred_idx" ON "audit_record" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_record_subject_idx" ON "audit_record" USING btree ("workspace_id","subject_type","subject_id");--> statement-breakpoint
CREATE POLICY "user_select" ON "app_user" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING (exists (
        select 1 from workspace_member wm
        where wm.user_id = "app_user"."id"
          and wm.workspace_id = tenancy.workspace_id()
          and wm.deleted_at is null
      ));--> statement-breakpoint
CREATE POLICY "user_update_self" ON "app_user" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("app_user"."id" = tenancy.user_id() and not tenancy.is_read_only()) WITH CHECK ("app_user"."id" = tenancy.user_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "app_user" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "workspace" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace"."id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "workspace" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "workspace" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "workspace_member" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "workspace_member" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "workspace_member" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "workspace_member" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "workspace_member" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "team" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "team" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "team" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "team" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "team" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "team_member" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "team_member" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "team_member" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "team_member" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "team_member" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "audit_record" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "audit_record" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "operator_select" ON "audit_record" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);