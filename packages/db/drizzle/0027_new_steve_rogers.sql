ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_bid_size" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_ask_size" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_bid_size" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_ask_size" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_microprice" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_microprice" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_touch_imbalance" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_touch_imbalance" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_book_imbalance_shares" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_book_imbalance_shares" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_book_imbalance_usd" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_book_imbalance_usd" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_depth_shares" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_depth_shares" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "up_depth_usd" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_state_snapshot" ADD COLUMN "down_depth_usd" double precision;