CREATE TABLE "signal_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"pair" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"pup" double precision NOT NULL,
	"score" double precision,
	"category" text,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "polymarket_updown_score" ADD COLUMN "gauge_pup" double precision;--> statement-breakpoint
CREATE INDEX "signal_snapshot_src_pair_idx" ON "signal_snapshot" USING btree ("source","pair","captured_at");