ALTER TABLE "polymarket_trade_flow_event" ADD COLUMN "verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "polymarket_trade_flow_event" ADD COLUMN "verification_attempted_at" timestamp;--> statement-breakpoint
-- Existing pending rows have already been selected by the legacy oldest-first verifier, often
-- repeatedly. Seed one durable attempt at rollout so they yield to never-attempted live evidence;
-- they become eligible for the unchanged public receipt lookup after the bounded retry interval.
UPDATE "polymarket_trade_flow_event"
SET "verification_attempts" = 1,
    "verification_attempted_at" = statement_timestamp()::timestamp
WHERE "chain_status" = 'pending';
