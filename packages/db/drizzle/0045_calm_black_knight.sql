CREATE TABLE "polymarket_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"connection_mode" text DEFAULT 'existing' NOT NULL,
	"wallet_type" text DEFAULT 'deposit' NOT NULL,
	"wallet_address" text NOT NULL,
	"signer_address" text NOT NULL,
	"encrypted_signer_key" text NOT NULL,
	"signer_key_nonce" text NOT NULL,
	"encrypted_relayer_api_key" text NOT NULL,
	"relayer_api_key_nonce" text NOT NULL,
	"enc_version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"max_order_cents" integer DEFAULT 500 NOT NULL,
	"max_open_exposure_cents" integer DEFAULT 2500 NOT NULL,
	"daily_loss_limit_cents" integer DEFAULT 2000 NOT NULL,
	"max_book_age_ms" integer DEFAULT 2000 NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp,
	"last_verification_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polymarket_account" ADD CONSTRAINT "polymarket_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "polymarket_account_user_idx" ON "polymarket_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_account_user_wallet_uidx" ON "polymarket_account" USING btree ("user_id","wallet_address");
