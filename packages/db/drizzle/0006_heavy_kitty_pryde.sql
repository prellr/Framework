CREATE TABLE "screen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"auto_rescreen" boolean DEFAULT false NOT NULL,
	"last_survivors" jsonb,
	"last_added" jsonb,
	"last_removed" jsonb,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;