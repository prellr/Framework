CREATE TABLE "login_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"session_id" text NOT NULL,
	"user_name" text NOT NULL,
	"user_email" text NOT NULL,
	"auth_method" text NOT NULL,
	"auth_path" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_event" ADD CONSTRAINT "login_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "login_event_session_id_uniq" ON "login_event" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "login_event_user_created_idx" ON "login_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_event_created_at_idx" ON "login_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_event_ip_created_idx" ON "login_event" USING btree ("ip_address","created_at");--> statement-breakpoint
INSERT INTO "login_event" (
	"user_id",
	"session_id",
	"user_name",
	"user_email",
	"auth_method",
	"auth_path",
	"ip_address",
	"user_agent",
	"created_at"
)
SELECT
	s."user_id",
	s."id",
	u."name",
	u."email",
	'existing session backfill',
	NULL,
	s."ip_address",
	s."user_agent",
	s."created_at"
FROM "session" s
INNER JOIN "user" u ON u."id" = s."user_id"
ON CONFLICT ("session_id") DO NOTHING;
