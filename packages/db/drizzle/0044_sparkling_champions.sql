ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "capacity_version" text;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_fill_10" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_fill_10" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_fill_20" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_fill_20" double precision;