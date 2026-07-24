ALTER TABLE "sweep_cell" ADD COLUMN "parameters" jsonb;--> statement-breakpoint
ALTER TABLE "sweep_cell" ADD COLUMN "param_label" text;--> statement-breakpoint
ALTER TABLE "sweep" ADD COLUMN "kind" text DEFAULT 'sweep' NOT NULL;