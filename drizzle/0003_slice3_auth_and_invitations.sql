CREATE TYPE "public"."verification_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."invitation_delivery" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TABLE "auth_credential" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_credential" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_verification_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_verification_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by_member_id" uuid NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"delivery_status" "invitation_delivery" DEFAULT 'pending' NOT NULL,
	"delivery_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invitation_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation_team" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invitation_team_key" UNIQUE("invitation_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_credential" ADD CONSTRAINT "auth_credential_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_verification_token" ADD CONSTRAINT "auth_verification_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_app_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_fk" FOREIGN KEY ("invited_by_member_id","workspace_id") REFERENCES "public"."workspace_member"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_invitation_fk" FOREIGN KEY ("invitation_id","workspace_id") REFERENCES "public"."invitation"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_team_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_credential_user_key" ON "auth_credential" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_expires_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_verification_token_key" ON "auth_verification_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_verification_user_purpose_idx" ON "auth_verification_token" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_key" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_workspace_email_pending_key" ON "invitation" USING btree ("workspace_id",lower("email")) WHERE "invitation"."status" = 'pending' and "invitation"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "invitation_workspace_status_idx" ON "invitation" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE POLICY "identity_manage" ON "app_user" AS PERMISSIVE FOR ALL TO "unifyops_identity" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "identity_insert" ON "workspace" AS PERMISSIVE FOR INSERT TO "unifyops_identity" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "identity_select" ON "workspace" AS PERMISSIVE FOR SELECT TO "unifyops_identity" USING (true);--> statement-breakpoint
CREATE POLICY "identity_select_own" ON "workspace_member" AS PERMISSIVE FOR SELECT TO "unifyops_identity" USING ("workspace_member"."user_id" = tenancy.user_id());--> statement-breakpoint
CREATE POLICY "identity_all" ON "auth_credential" AS PERMISSIVE FOR ALL TO "unifyops_identity" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "identity_all" ON "auth_session" AS PERMISSIVE FOR ALL TO "unifyops_identity" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "identity_all" ON "auth_verification_token" AS PERMISSIVE FOR ALL TO "unifyops_identity" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "invitation" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "invitation" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "invitation" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "invitation" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "invitation" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);--> statement-breakpoint
CREATE POLICY "identity_select" ON "invitation" AS PERMISSIVE FOR SELECT TO "unifyops_identity" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_select" ON "invitation_team" AS PERMISSIVE FOR SELECT TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "invitation_team" AS PERMISSIVE FOR INSERT TO "unifyops_app" WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_update" ON "invitation_team" AS PERMISSIVE FOR UPDATE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()) WITH CHECK ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "tenant_delete" ON "invitation_team" AS PERMISSIVE FOR DELETE TO "unifyops_app" USING ("workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only());--> statement-breakpoint
CREATE POLICY "operator_select" ON "invitation_team" AS PERMISSIVE FOR SELECT TO "unifyops_operator" USING (true);