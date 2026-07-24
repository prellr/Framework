CREATE TABLE "sweep_cell" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sweep_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"backtest_run_id" uuid,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sweep" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"matrix" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_cells" integer DEFAULT 0 NOT NULL,
	"done_cells" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sweep_cell" ADD CONSTRAINT "sweep_cell_sweep_id_sweep_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "public"."sweep"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep_cell" ADD CONSTRAINT "sweep_cell_backtest_run_id_backtest_run_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep" ADD CONSTRAINT "sweep_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cell_by_sweep" ON "sweep_cell" USING btree ("sweep_id");