CREATE TABLE "polymarket_state_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"sample_minute" integer NOT NULL,
	"remaining_sec" integer NOT NULL,
	"reference_source" text NOT NULL,
	"chainlink_spot" double precision,
	"chainlink_strike" double precision,
	"chainlink_age_sec" double precision,
	"hl_spot" double precision,
	"hl_strike" double precision,
	"hl_age_sec" double precision,
	"basis_bps" double precision,
	"sigma_per_min" double precision,
	"log_moneyness" double precision,
	"z_distance" double precision,
	"up_bid" double precision,
	"up_ask" double precision,
	"down_bid" double precision,
	"down_ask" double precision,
	"up_fill_5" double precision,
	"down_fill_5" double precision,
	"label_status" text DEFAULT 'open' NOT NULL,
	"resolved_up" boolean,
	"labeled_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_state_market_minute_idx" ON "polymarket_state_snapshot" USING btree ("condition_id","sample_minute");--> statement-breakpoint
CREATE INDEX "pm_state_label_idx" ON "polymarket_state_snapshot" USING btree ("label_status","end_date");--> statement-breakpoint
CREATE INDEX "pm_state_feature_idx" ON "polymarket_state_snapshot" USING btree ("horizon_min","remaining_sec","z_distance");--> statement-breakpoint
CREATE INDEX "pm_state_pair_time_idx" ON "polymarket_state_snapshot" USING btree ("pair","captured_at");