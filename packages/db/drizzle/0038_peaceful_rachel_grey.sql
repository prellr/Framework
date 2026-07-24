ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_version" text;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_canonical_5s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_canonical_30s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_canonical_60s" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_up_events_60s" integer;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_down_events_60s" integer;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_source_age_sec" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_receive_age_sec" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "clob_event_ofi_max_transport_lag_ms_60s" double precision;