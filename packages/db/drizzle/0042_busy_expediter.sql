ALTER TABLE "polymarket_trade_flow_event" ADD COLUMN "chain_transaction_hash" text;--> statement-breakpoint
ALTER TABLE "polymarket_trade_flow_event" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "polymarket_trade_flow_event" ADD CONSTRAINT "pm_trade_flow_verification_method_chk" CHECK ("polymarket_trade_flow_event"."verification_method" is null
        or "polymarket_trade_flow_event"."verification_method" in ('source_hash','data_api_replacement'));
