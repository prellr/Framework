CREATE TABLE "polymarket_updown_score" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"implied_pup" double precision,
	"tess_pup" double precision,
	"gauge" double precision,
	"edge" double precision,
	"resolved_up" boolean NOT NULL,
	"signal_age_sec" double precision,
	"source" text DEFAULT 'forward' NOT NULL,
	"scored_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_updown_condition_idx" ON "polymarket_updown_score" USING btree ("condition_id");