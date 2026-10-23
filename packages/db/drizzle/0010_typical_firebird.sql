ALTER TABLE "order_events" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD COLUMN "orders_cancelled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD COLUMN "runs_closed" integer DEFAULT 0 NOT NULL;