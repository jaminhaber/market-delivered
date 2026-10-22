ALTER TABLE "auth_rate_limits" DROP CONSTRAINT "auth_rate_limits_pkey";--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ADD COLUMN "id" text DEFAULT gen_random_uuid()::text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key");
