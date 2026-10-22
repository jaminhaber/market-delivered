CREATE TABLE "background_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"schedules_processed" integer DEFAULT 0 NOT NULL,
	"runs_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "background_jobs_status_valid" CHECK ("background_job_runs"."status" IN ('running','succeeded','failed','skipped'))
);
--> statement-breakpoint
CREATE INDEX "background_jobs_name_started_idx" ON "background_job_runs" USING btree ("name","started_at");