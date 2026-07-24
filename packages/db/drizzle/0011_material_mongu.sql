CREATE TABLE "strategy_param_period" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"param_hash8" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "param_period_strategy_idx" ON "strategy_param_period" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "param_period_open_idx" ON "strategy_param_period" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "param_period_pair_idx" ON "strategy_param_period" USING btree ("pair");