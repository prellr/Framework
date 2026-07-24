CREATE TABLE "venue_price_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"sampled_at" timestamp NOT NULL,
	"chainlink_price" double precision NOT NULL,
	"chainlink_source_at" timestamp NOT NULL,
	"chainlink_received_at" timestamp NOT NULL,
	"chainlink_age_ms" double precision NOT NULL,
	"hl_mid" double precision NOT NULL,
	"hl_source_at" timestamp NOT NULL,
	"hl_received_at" timestamp NOT NULL,
	"hl_age_ms" double precision NOT NULL,
	"basis_bps" double precision NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "venue_price_pair_second_idx" ON "venue_price_snapshot" USING btree ("pair","sampled_at");--> statement-breakpoint
CREATE INDEX "venue_price_sampled_at_idx" ON "venue_price_snapshot" USING btree ("sampled_at");