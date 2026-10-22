ALTER TABLE "customer_profiles" ADD COLUMN "street" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "region" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "postal_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "geocoded_address" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "geocoder" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "street" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "region" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postal_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "geocoded_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "geocoder" text;