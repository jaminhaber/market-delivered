CREATE TYPE "public"."produce_category" AS ENUM('Vegetables', 'Fruit', 'Herbs');--> statement-breakpoint
CREATE TYPE "public"."produce_unit" AS ENUM('lb', 'bunch', 'basket', 'each');--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produce" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" "produce_category" NOT NULL,
	"unit" "produce_unit" NOT NULL,
	"price_cents" integer NOT NULL,
	"available_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produce_price_nonnegative" CHECK ("produce"."price_cents" >= 0),
	CONSTRAINT "produce_quantity_nonnegative" CHECK ("produce"."available_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "produce" ADD CONSTRAINT "produce_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "produce_farm_idx" ON "produce" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "produce_category_idx" ON "produce" USING btree ("category");