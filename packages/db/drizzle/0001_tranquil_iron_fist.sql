CREATE TABLE "jester_credential" (
	"user_id" text PRIMARY KEY NOT NULL,
	"base_url" text DEFAULT 'https://app.jester.trade' NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_nonce" text NOT NULL,
	"enc_version" integer DEFAULT 1 NOT NULL,
	"account_id" text,
	"hyperliquid_ready" boolean,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jester_credential" ADD CONSTRAINT "jester_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;