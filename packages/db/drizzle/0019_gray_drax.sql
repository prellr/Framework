CREATE TABLE "polymarket_book_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"slug" text,
	"pair" text NOT NULL,
	"horizon_min" integer NOT NULL,
	"window_start" timestamp NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"up_bid" double precision,
	"up_ask" double precision,
	"down_bid" double precision,
	"down_ask" double precision
);
--> statement-breakpoint
ALTER TABLE "polymarket_updown_score" ADD COLUMN "up_ask" double precision;--> statement-breakpoint
ALTER TABLE "polymarket_updown_score" ADD COLUMN "down_ask" double precision;--> statement-breakpoint
CREATE INDEX "pm_book_condition_idx" ON "polymarket_book_snapshot" USING btree ("condition_id");