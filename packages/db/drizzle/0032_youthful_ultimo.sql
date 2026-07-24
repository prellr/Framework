CREATE TABLE "polymarket_trade_flow_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"version" text NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"outcome_side" text NOT NULL,
	"reported_side" text NOT NULL,
	"price" double precision NOT NULL,
	"shares" double precision NOT NULL,
	"notional_usd" double precision NOT NULL,
	"fee_rate_bps" double precision,
	"event_at" timestamp NOT NULL,
	"received_at" timestamp NOT NULL,
	"ingestion_latency_ms" double precision NOT NULL,
	"transaction_hash" text,
	"chain_status" text DEFAULT 'pending' NOT NULL,
	"chain_block_number" bigint,
	"chain_confirmations" integer,
	"chain_exchange" text,
	"chain_side" text,
	"chain_token_id" text,
	"chain_maker_amount" text,
	"chain_taker_amount" text,
	"chain_price" double precision,
	"chain_shares" double precision,
	"verified_at" timestamp,
	"verification_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_trade_flow_fingerprint_idx" ON "polymarket_trade_flow_event" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "pm_trade_flow_event_at_idx" ON "polymarket_trade_flow_event" USING btree ("event_at");--> statement-breakpoint
CREATE INDEX "pm_trade_flow_market_time_idx" ON "polymarket_trade_flow_event" USING btree ("condition_id","event_at");--> statement-breakpoint
CREATE INDEX "pm_trade_flow_pair_window_idx" ON "polymarket_trade_flow_event" USING btree ("pair","window_start");--> statement-breakpoint
CREATE INDEX "pm_trade_flow_chain_status_idx" ON "polymarket_trade_flow_event" USING btree ("chain_status","event_at");--> statement-breakpoint
CREATE INDEX "pm_trade_flow_transaction_idx" ON "polymarket_trade_flow_event" USING btree ("transaction_hash");