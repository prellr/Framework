CREATE TABLE "polymarket_smooth_path_funnel" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"bot_key" text NOT NULL,
	"condition_id" text NOT NULL,
	"pair" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"observed_at" timestamp,
	"book_request_duration_ms" integer,
	"observed" boolean DEFAULT false NOT NULL,
	"path_qualified" boolean DEFAULT false NOT NULL,
	"book_qualified" boolean DEFAULT false NOT NULL,
	"placed" boolean DEFAULT false NOT NULL,
	"rejection_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"tick_count" integer,
	"start_coverage_sec" double precision,
	"max_intertick_gap_sec" double precision,
	"source_age_sec" double precision,
	"receive_age_sec" double precision,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pm_smooth_funnel_version_chk" CHECK ("polymarket_smooth_path_funnel"."version" in ('updown-smooth-path-displacement-v1','updown-smooth-path-causal-displacement-v2')),
	CONSTRAINT "pm_smooth_funnel_bot_chk" CHECK ("polymarket_smooth_path_funnel"."bot_key" in ('smoothPathDisplacement','smoothPathCausalDisplacement')),
	CONSTRAINT "pm_smooth_funnel_pair_chk" CHECK ("polymarket_smooth_path_funnel"."pair" in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')),
	CONSTRAINT "pm_smooth_funnel_boundary_chk" CHECK ("polymarket_smooth_path_funnel"."window_start" >= timestamp '2026-07-23 22:00:00'),
	CONSTRAINT "pm_smooth_funnel_stage_chk" CHECK ((not "polymarket_smooth_path_funnel"."path_qualified" or "polymarket_smooth_path_funnel"."observed")
        and (not "polymarket_smooth_path_funnel"."book_qualified" or "polymarket_smooth_path_funnel"."path_qualified")
        and (not "polymarket_smooth_path_funnel"."placed" or "polymarket_smooth_path_funnel"."book_qualified")),
	CONSTRAINT "pm_smooth_funnel_tick_count_chk" CHECK ("polymarket_smooth_path_funnel"."tick_count" is null or "polymarket_smooth_path_funnel"."tick_count" >= 0),
	CONSTRAINT "pm_smooth_funnel_request_duration_chk" CHECK ("polymarket_smooth_path_funnel"."book_request_duration_ms" is null or "polymarket_smooth_path_funnel"."book_request_duration_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_smooth_funnel_version_market_idx" ON "polymarket_smooth_path_funnel" USING btree ("version","condition_id");--> statement-breakpoint
CREATE INDEX "pm_smooth_funnel_version_window_idx" ON "polymarket_smooth_path_funnel" USING btree ("version","window_start");--> statement-breakpoint
CREATE INDEX "pm_smooth_funnel_pair_window_idx" ON "polymarket_smooth_path_funnel" USING btree ("pair","window_start");