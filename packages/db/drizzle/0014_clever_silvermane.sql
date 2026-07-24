CREATE TABLE "robustness_result" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"param_hash" text DEFAULT 'default' NOT NULL,
	"verdict" text NOT NULL,
	"score" integer NOT NULL,
	"widest_trades" integer,
	"min_profit_factor" double precision,
	"widest_return" double precision,
	"positive_horizons" integer,
	"total_horizons" integer,
	"oos_proxy_return" double precision,
	"evaluated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "robustness_cell_idx" ON "robustness_result" USING btree ("strategy_id","pair","timeframe","param_hash");