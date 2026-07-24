CREATE TABLE "strategy" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" text,
	"category" text,
	"cached_stats" jsonb,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" text NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"days_requested" integer NOT NULL,
	"actual_start" date,
	"actual_end" date,
	"span_days" integer NOT NULL,
	"total_return" numeric,
	"total_trades" integer,
	"win_rate" numeric,
	"max_drawdown" numeric,
	"sharpe" numeric,
	"profit_factor" numeric,
	"parameters" jsonb,
	"param_hash" text DEFAULT 'default' NOT NULL,
	"raw_result" jsonb,
	"as_of_bucket" date NOT NULL,
	"ran_with_key_user_id" text,
	"requested_by_user_id" text,
	"ran_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pair_timeframe_span" (
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"max_span_days" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_run" ADD CONSTRAINT "backtest_run_strategy_id_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_run" ADD CONSTRAINT "backtest_run_ran_with_key_user_id_user_id_fk" FOREIGN KEY ("ran_with_key_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_run" ADD CONSTRAINT "backtest_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_cell" ON "backtest_run" USING btree ("strategy_id","pair","timeframe","span_days","param_hash","as_of_bucket");--> statement-breakpoint
CREATE INDEX "bt_by_strategy" ON "backtest_run" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "bt_by_pair_tf" ON "backtest_run" USING btree ("pair","timeframe");--> statement-breakpoint
CREATE UNIQUE INDEX "pts_pk" ON "pair_timeframe_span" USING btree ("pair","timeframe");