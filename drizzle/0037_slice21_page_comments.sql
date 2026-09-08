ALTER TABLE "comment" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ALTER COLUMN "work_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "wiki_page_id" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_page_fk" FOREIGN KEY ("wiki_page_id","workspace_id") REFERENCES "public"."wiki_page"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_page_idx" ON "comment" USING btree ("wiki_page_id","created_at","id");