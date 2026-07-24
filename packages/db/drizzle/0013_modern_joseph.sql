CREATE TABLE "hl_fill" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"tid" bigint NOT NULL,
	"time" bigint NOT NULL,
	"coin" text NOT NULL,
	"closed_pnl" double precision DEFAULT 0 NOT NULL,
	"fee" double precision DEFAULT 0 NOT NULL,
	"dir" text DEFAULT '' NOT NULL,
	"px" double precision DEFAULT 0 NOT NULL,
	"sz" double precision DEFAULT 0 NOT NULL,
	"side" text DEFAULT '' NOT NULL,
	"oid" bigint DEFAULT 0 NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hl_fill_wallet_tid_idx" ON "hl_fill" USING btree ("wallet","tid");--> statement-breakpoint
CREATE INDEX "hl_fill_wallet_time_idx" ON "hl_fill" USING btree ("wallet","time");