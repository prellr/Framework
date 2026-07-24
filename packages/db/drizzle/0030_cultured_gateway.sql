CREATE TABLE "polymarket_complete_set_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"captured_at" timestamp NOT NULL,
	"request_started_at" timestamp NOT NULL,
	"request_duration_ms" integer NOT NULL,
	"sample_minute" integer NOT NULL,
	"remaining_sec" integer NOT NULL,
	"up_token_id" text NOT NULL,
	"down_token_id" text NOT NULL,
	"shares_per_leg" double precision NOT NULL,
	"up_vwap" double precision NOT NULL,
	"down_vwap" double precision NOT NULL,
	"up_gross_cost" double precision NOT NULL,
	"down_gross_cost" double precision NOT NULL,
	"fee_rate" double precision NOT NULL,
	"fee_exponent" double precision NOT NULL,
	"up_fee_usd" double precision NOT NULL,
	"down_fee_usd" double precision NOT NULL,
	"gross_cost_per_share" double precision NOT NULL,
	"effective_cost_per_share" double precision NOT NULL,
	"pre_gas_merge_edge" double precision NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_complete_set_market_minute_idx" ON "polymarket_complete_set_snapshot" USING btree ("condition_id","sample_minute");--> statement-breakpoint
CREATE INDEX "pm_complete_set_capture_idx" ON "polymarket_complete_set_snapshot" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "pm_complete_set_condition_idx" ON "polymarket_complete_set_snapshot" USING btree ("condition_id");