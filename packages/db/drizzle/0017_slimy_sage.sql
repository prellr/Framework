CREATE TABLE "kb_article" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[],
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"superseded_by_slug" text,
	"sources" jsonb,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "kb_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[],
	"body" text NOT NULL,
	"edited_by" text,
	"edited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_revision" ADD CONSTRAINT "kb_revision_article_id_kb_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_article_category_idx" ON "kb_article" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "kb_revision_article_idx" ON "kb_revision" USING btree ("article_id","edited_at");