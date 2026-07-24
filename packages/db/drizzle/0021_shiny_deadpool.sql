CREATE TABLE "paper_trade" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bot_key" text NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	"side" text NOT NULL,
	"p_signal" double precision,
	"implied_mid" double precision,
	"ask_paid" double precision NOT NULL,
	"edge_mid" double precision,
	"edge_ask" double precision,
	"size_usd" double precision NOT NULL,
	"signal_age_sec" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"pnl_usd" double precision,
	"graded_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "paper_trade_bot_market_idx" ON "paper_trade" USING btree ("bot_key","condition_id");--> statement-breakpoint
CREATE INDEX "paper_trade_status_idx" ON "paper_trade" USING btree ("status","end_date");--> statement-breakpoint
CREATE INDEX "paper_trade_window_idx" ON "paper_trade" USING btree ("window_start");