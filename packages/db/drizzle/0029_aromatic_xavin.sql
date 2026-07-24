CREATE TABLE "polymarket_bundle_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"end_date" timestamp NOT NULL,
	"captured_at" timestamp NOT NULL,
	"fetch_started_at" timestamp NOT NULL,
	"lower_leg_fetched_at" timestamp NOT NULL,
	"higher_leg_fetched_at" timestamp NOT NULL,
	"fetch_span_ms" integer NOT NULL,
	"sample_minute" integer NOT NULL,
	"remaining_sec" integer NOT NULL,
	"lower_condition_id" text NOT NULL,
	"higher_condition_id" text NOT NULL,
	"lower_horizon_min" integer NOT NULL,
	"higher_horizon_min" integer NOT NULL,
	"lower_strike" double precision NOT NULL,
	"higher_strike" double precision NOT NULL,
	"lower_up_token_id" text NOT NULL,
	"higher_down_token_id" text NOT NULL,
	"shares_per_leg" double precision NOT NULL,
	"lower_up_vwap" double precision NOT NULL,
	"higher_down_vwap" double precision NOT NULL,
	"lower_up_gross_cost" double precision NOT NULL,
	"higher_down_gross_cost" double precision NOT NULL,
	"lower_fee_rate" double precision NOT NULL,
	"lower_fee_exponent" double precision NOT NULL,
	"higher_fee_rate" double precision NOT NULL,
	"higher_fee_exponent" double precision NOT NULL,
	"lower_fee_usd" double precision NOT NULL,
	"higher_fee_usd" double precision NOT NULL,
	"gross_bundle_cost_per_share" double precision NOT NULL,
	"effective_bundle_cost_per_share" double precision NOT NULL,
	"bundle_edge" double precision NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_bundle_lower_market_minute_idx" ON "polymarket_bundle_snapshot" USING btree ("lower_condition_id","sample_minute");--> statement-breakpoint
CREATE INDEX "pm_bundle_capture_idx" ON "polymarket_bundle_snapshot" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "pm_bundle_common_close_idx" ON "polymarket_bundle_snapshot" USING btree ("pair","end_date");