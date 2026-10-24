-- Market dates, schedules, inventory, orders, purchases, history and jobs.
CREATE TYPE "public"."order_status" AS ENUM('placed', 'claimed', 'shopping', 'ready', 'out_for_delivery', 'delivered', 'delivery_failed', 'unavailable', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('scheduled', 'shopping', 'delivering', 'completed', 'cancelled');
--> statement-breakpoint
CREATE TABLE "background_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"schedules_processed" integer DEFAULT 0 NOT NULL,
	"orders_cancelled" integer DEFAULT 0 NOT NULL,
	"runs_closed" integer DEFAULT 0 NOT NULL,
	"runs_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "background_jobs_status_valid" CHECK ("background_job_runs"."status" IN ('running','succeeded','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"produce_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "inventory_valid" CHECK ("inventory"."quantity" >= 0 AND "inventory"."reserved_quantity" >= 0 AND "inventory"."reserved_quantity" <= "inventory"."quantity" AND "inventory"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"schedule_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"delivery_start_at" timestamp with time zone NOT NULL,
	"delivery_end_at" timestamp with time zone NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"status" "run_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_dates_valid" CHECK ("market_runs"."cutoff_at" <= "market_runs"."starts_at" AND "market_runs"."starts_at" < "market_runs"."ends_at" AND "market_runs"."delivery_start_at" >= "market_runs"."starts_at" AND "market_runs"."delivery_end_at" > "market_runs"."delivery_start_at"),
	CONSTRAINT "run_fee_nonnegative" CHECK ("market_runs"."delivery_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_minute" integer NOT NULL,
	"closes_minute" integer NOT NULL,
	"cutoff_minutes" integer DEFAULT 720 NOT NULL,
	"delivery_delay_minutes" integer DEFAULT 0 NOT NULL,
	"delivery_duration_minutes" integer DEFAULT 120 NOT NULL,
	"delivery_fee_cents" integer DEFAULT 500 NOT NULL,
	"skip_thanksgiving" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "schedule_delivery_during_market" CHECK ("market_schedules"."delivery_delay_minutes" < "market_schedules"."closes_minute" - "market_schedules"."opens_minute"),
	CONSTRAINT "market_schedule_valid" CHECK ("market_schedules"."weekday" BETWEEN 0 AND 6 AND "market_schedules"."opens_minute" BETWEEN 0 AND 1439 AND "market_schedules"."closes_minute" > "market_schedules"."opens_minute" AND "market_schedules"."closes_minute" <= 1440 AND "market_schedules"."cutoff_minutes" BETWEEN 0 AND 10080 AND "market_schedules"."delivery_delay_minutes" BETWEEN 0 AND 1440 AND "market_schedules"."delivery_duration_minutes" BETWEEN 1 AND 1440 AND "market_schedules"."delivery_fee_cents" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" text,
	"status" "order_status" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"inventory_id" uuid NOT NULL,
	"farm_id" uuid NOT NULL,
	"farm_name" text NOT NULL,
	"farm_location" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"fulfilled_quantity" integer,
	"actual_cost_cents" integer,
	CONSTRAINT "order_item_valid" CHECK ("order_items"."quantity" > 0 AND "order_items"."price_cents" >= 0 AND ("order_items"."fulfilled_quantity" IS NULL OR "order_items"."fulfilled_quantity" BETWEEN 0 AND "order_items"."quantity") AND ("order_items"."actual_cost_cents" IS NULL OR "order_items"."actual_cost_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"driver_id" text,
	"claimed_at" timestamp with time zone,
	"status" "order_status" DEFAULT 'placed' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"google_place_id" text,
	"street" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"geocoded_address" text,
	"geocoded_at" timestamp with time zone,
	"geocoder" text,
	"delivery_notes" text NOT NULL,
	"delivery_fee_cents" integer NOT NULL,
	"estimated_total_cents" integer NOT NULL,
	"actual_total_cents" integer,
	"cash_collected_cents" integer DEFAULT 0 NOT NULL,
	"cash_recorded_at" timestamp with time zone,
	"cash_recorded_by" text,
	"cash_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "order_assignment_valid" CHECK ("orders"."status" NOT IN ('claimed', 'shopping', 'ready', 'out_for_delivery', 'delivery_failed', 'delivered') OR "orders"."driver_id" IS NOT NULL),
	CONSTRAINT "order_cash_valid" CHECK ("orders"."cash_collected_cents" >= 0 AND "orders"."cash_collected_cents" <= coalesce("orders"."actual_total_cents", 0)),
	CONSTRAINT "order_amounts_valid" CHECK ("orders"."delivery_fee_cents" >= 0 AND "orders"."estimated_total_cents" >= 0 AND ("orders"."actual_total_cents" IS NULL OR "orders"."actual_total_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"order_item_id" uuid PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"recorded_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_valid" CHECK ("purchases"."quantity" >= 0 AND "purchases"."total_cost_cents" >= 0 AND ("purchases"."quantity" > 0 OR "purchases"."total_cost_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "schedule_inventory" (
	"schedule_id" uuid NOT NULL,
	"produce_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "schedule_inventory_schedule_id_produce_id_pk" PRIMARY KEY("schedule_id","produce_id"),
	CONSTRAINT "schedule_inventory_valid" CHECK ("schedule_inventory"."price_cents" BETWEEN 0 AND 1000000 AND "schedule_inventory"."quantity" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_run_id_market_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."market_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_produce_id_produce_id_fk" FOREIGN KEY ("produce_id") REFERENCES "public"."produce"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_schedule_id_market_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."market_schedules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "market_schedules_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customer_profiles_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profiles"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_run_id_market_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."market_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cash_recorded_by_users_id_fk" FOREIGN KEY ("cash_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_schedule_id_market_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."market_schedules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_produce_id_produce_id_fk" FOREIGN KEY ("produce_id") REFERENCES "public"."produce"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "background_jobs_name_started_idx" ON "background_job_runs" USING btree ("name","started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_run_produce_unique" ON "inventory" USING btree ("run_id","produce_id");
--> statement-breakpoint
CREATE INDEX "runs_schedule_idx" ON "market_runs" USING btree ("starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "run_market_start_unique" ON "market_runs" USING btree ("market_id","starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_schedule_weekday_unique" ON "market_schedules" USING btree ("market_id","weekday");
--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_inventory_unique" ON "order_items" USING btree ("order_id","inventory_id");
--> statement-breakpoint
CREATE INDEX "order_items_inventory_idx" ON "order_items" USING btree ("inventory_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_request_unique" ON "orders" USING btree ("customer_id","request_id");
--> statement-breakpoint
CREATE INDEX "orders_run_idx" ON "orders" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "orders_driver_idx" ON "orders" USING btree ("driver_id");
--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
