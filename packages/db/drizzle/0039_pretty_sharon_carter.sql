CREATE TABLE "research_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"shard_id" uuid,
	"kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"storage_uri" text NOT NULL,
	"format" text NOT NULL,
	"schema_version" text NOT NULL,
	"byte_size" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_artifact_kind_check" CHECK ("research_artifact"."kind" in (
        'candidate-results', 'predictions', 'model', 'trades', 'equity',
        'segments', 'logs', 'selection-manifest'
      )),
	CONSTRAINT "research_artifact_byte_size" CHECK ("research_artifact"."byte_size" is null or "research_artifact"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "research_candidate_result" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"experiment_id" uuid NOT NULL,
	"shard_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"candidate_id" text NOT NULL,
	"target_id" text NOT NULL,
	"trades" integer NOT NULL,
	"gross_mean_bps" double precision,
	"net_mean_bps" double precision,
	"standard_error_bps" double precision,
	"lower_confidence_bound_bps" double precision,
	"hit_rate" double precision,
	"selection_score" double precision,
	"capital_summary" jsonb,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_candidate_result_stage_check" CHECK ("research_candidate_result"."stage" in ('discovery', 'validation')),
	CONSTRAINT "research_candidate_result_trades" CHECK ("research_candidate_result"."trades" >= 0),
	CONSTRAINT "research_candidate_result_hit_rate" CHECK ("research_candidate_result"."hit_rate" is null or ("research_candidate_result"."hit_rate" >= 0 and "research_candidate_result"."hit_rate" <= 1))
);
--> statement-breakpoint
CREATE TABLE "research_dataset_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_version" text NOT NULL,
	"dataset_key" text NOT NULL,
	"dataset_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"artifact_uri" text NOT NULL,
	"artifact_format" text NOT NULL,
	"artifact_schema_version" text NOT NULL,
	"row_count" bigint NOT NULL,
	"assets" jsonb NOT NULL,
	"columns" jsonb NOT NULL,
	"event_start" timestamp with time zone NOT NULL,
	"event_end" timestamp with time zone NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"availability_clock" text NOT NULL,
	"boundary" jsonb NOT NULL,
	"label_spec" jsonb NOT NULL,
	"source_specs" jsonb NOT NULL,
	"target_specs" jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_dataset_positive_rows" CHECK ("research_dataset_manifest"."row_count" > 0),
	CONSTRAINT "research_dataset_receive_clock" CHECK ("research_dataset_manifest"."availability_clock" = 'receive_clock'),
	CONSTRAINT "research_dataset_status_check" CHECK ("research_dataset_manifest"."status" in ('ready', 'superseded', 'failed')),
	CONSTRAINT "research_dataset_time_order" CHECK ("research_dataset_manifest"."event_end" > "research_dataset_manifest"."event_start" and "research_dataset_manifest"."frozen_at" >= "research_dataset_manifest"."event_end")
);
--> statement-breakpoint
CREATE TABLE "research_experiment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_user_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stage" text DEFAULT 'discovery' NOT NULL,
	"dataset_id" uuid NOT NULL,
	"candidate_manifest_hash" text NOT NULL,
	"candidate_manifest_uri" text NOT NULL,
	"candidate_manifest_format" text NOT NULL,
	"candidate_manifest_schema_version" text NOT NULL,
	"candidate_count" integer NOT NULL,
	"target_ids" jsonb NOT NULL,
	"family_size" bigint NOT NULL,
	"shard_size" integer NOT NULL,
	"resource_class" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"target_adapter_version" text NOT NULL,
	"cost_model" jsonb NOT NULL,
	"capital_policy" jsonb NOT NULL,
	"selection_policy" jsonb NOT NULL,
	"seed" integer NOT NULL,
	"validation_boundary_at" timestamp with time zone,
	"paper_only" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_experiment_kind_check" CHECK ("research_experiment"."kind" in ('formula', 'ml', 'hybrid')),
	CONSTRAINT "research_experiment_status_check" CHECK ("research_experiment"."status" in (
        'draft', 'queued', 'running', 'discovery_complete', 'frozen',
        'validation_running', 'completed', 'failed', 'canceled'
      )),
	CONSTRAINT "research_experiment_stage_check" CHECK ("research_experiment"."stage" in ('discovery', 'validation')),
	CONSTRAINT "research_experiment_resource_check" CHECK ("research_experiment"."resource_class" in ('cpu', 'memory', 'gpu')),
	CONSTRAINT "research_experiment_positive_counts" CHECK ("research_experiment"."candidate_count" > 0 and "research_experiment"."family_size" > 0 and "research_experiment"."shard_size" > 0),
	CONSTRAINT "research_experiment_paper_only" CHECK ("research_experiment"."paper_only" = true)
);
--> statement-breakpoint
CREATE TABLE "research_shard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"stage" text NOT NULL,
	"target_id" text NOT NULL,
	"candidate_start" integer NOT NULL,
	"candidate_end" integer NOT NULL,
	"resource_class" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"leased_by" text,
	"lease_token_hash" text,
	"leased_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"result_digest" text,
	"runtime_ms" integer,
	"evaluated_candidates" integer,
	"evaluated_rows" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_shard_status_check" CHECK ("research_shard"."status" in ('queued', 'leased', 'completed', 'failed', 'canceled')),
	CONSTRAINT "research_shard_stage_check" CHECK ("research_shard"."stage" in ('discovery', 'validation')),
	CONSTRAINT "research_shard_resource_check" CHECK ("research_shard"."resource_class" in ('cpu', 'memory', 'gpu')),
	CONSTRAINT "research_shard_candidate_range" CHECK ("research_shard"."candidate_start" >= 0 and "research_shard"."candidate_end" > "research_shard"."candidate_start"),
	CONSTRAINT "research_shard_attempts" CHECK ("research_shard"."attempt" >= 0 and "research_shard"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "research_artifact" ADD CONSTRAINT "research_artifact_experiment_id_research_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."research_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_artifact" ADD CONSTRAINT "research_artifact_shard_id_research_shard_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."research_shard"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_candidate_result" ADD CONSTRAINT "research_candidate_result_experiment_id_research_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."research_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_candidate_result" ADD CONSTRAINT "research_candidate_result_shard_id_research_shard_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."research_shard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiment" ADD CONSTRAINT "research_experiment_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiment" ADD CONSTRAINT "research_experiment_dataset_id_research_dataset_manifest_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."research_dataset_manifest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_shard" ADD CONSTRAINT "research_shard_experiment_id_research_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."research_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_artifact_content_uniq" ON "research_artifact" USING btree ("experiment_id","kind","content_hash");--> statement-breakpoint
CREATE INDEX "research_artifact_shard_idx" ON "research_artifact" USING btree ("shard_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "research_candidate_result_uniq" ON "research_candidate_result" USING btree ("experiment_id","stage","candidate_id","target_id");--> statement-breakpoint
CREATE INDEX "research_candidate_rank_idx" ON "research_candidate_result" USING btree ("experiment_id","stage","selection_score");--> statement-breakpoint
CREATE INDEX "research_candidate_target_idx" ON "research_candidate_result" USING btree ("experiment_id","target_id","net_mean_bps");--> statement-breakpoint
CREATE UNIQUE INDEX "research_dataset_content_hash_uniq" ON "research_dataset_manifest" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "research_dataset_version_uniq" ON "research_dataset_manifest" USING btree ("dataset_key","dataset_version");--> statement-breakpoint
CREATE INDEX "research_dataset_status_idx" ON "research_dataset_manifest" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "research_experiment_status_idx" ON "research_experiment" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "research_experiment_dataset_idx" ON "research_experiment" USING btree ("dataset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_shard_ordinal_uniq" ON "research_shard" USING btree ("experiment_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "research_shard_partition_uniq" ON "research_shard" USING btree ("experiment_id","stage","target_id","candidate_start","candidate_end");--> statement-breakpoint
CREATE INDEX "research_shard_lease_idx" ON "research_shard" USING btree ("status","resource_class","priority","lease_expires_at");--> statement-breakpoint
CREATE INDEX "research_shard_experiment_idx" ON "research_shard" USING btree ("experiment_id","status");
