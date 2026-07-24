ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_version" text;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_imbalance_5s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_imbalance_30s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_imbalance_60s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_notional_60s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_trade_count_60s" integer;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_max_trade_share_60s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_source_age_sec" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_receive_age_sec" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "hl_flow_max_transport_lag_ms_60s" double precision;