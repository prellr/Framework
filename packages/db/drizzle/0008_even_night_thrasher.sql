CREATE TABLE "strategy_doc" (
	"strategy_id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"key_params" jsonb,
	"generated_by" text,
	"authored_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "entry_summary" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "exit_summary" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "indicator_summary" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "risk_settings" jsonb;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "native_timeframe" text;--> statement-breakpoint
ALTER TABLE "strategy_doc" ADD CONSTRAINT "strategy_doc_strategy_id_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategy"("id") ON DELETE cascade ON UPDATE no action;