CREATE TABLE "macro_breadth_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"bar_start" timestamp NOT NULL,
	"bar_end" timestamp NOT NULL,
	"captured_at" timestamp NOT NULL,
	"state" text NOT NULL,
	"btc_cmo" double precision NOT NULL,
	"eth_cmo" double precision NOT NULL,
	"sol_cmo" double precision NOT NULL,
	"median_cmo" double precision NOT NULL,
	"median_abs_cmo" double precision NOT NULL,
	"source_age_sec" double precision NOT NULL,
	"eligible_windows" integer NOT NULL,
	"observed_windows" integer NOT NULL,
	"qualified_decisions" integer NOT NULL,
	"placed_rows" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "macro_breadth_version_bar_idx" ON "macro_breadth_snapshot" USING btree ("version","bar_start");--> statement-breakpoint
CREATE INDEX "macro_breadth_capture_idx" ON "macro_breadth_snapshot" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "macro_breadth_state_idx" ON "macro_breadth_snapshot" USING btree ("state","bar_start");