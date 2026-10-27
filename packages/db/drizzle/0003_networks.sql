-- Network ownership, isolation, branding, support, location and email settings.
-- Apply after 0000–0002 to a fresh database. No network or business data is seeded.
CREATE TABLE "network_memberships" (
	"network_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "network_memberships_network_id_user_id_pk" PRIMARY KEY("network_id","user_id"),
	CONSTRAINT "membership_role_valid" CHECK ("network_memberships"."role" IN ('member', 'network_admin'))
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"support_email" text,
	"support_phone" text,
	"contact_url" text,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_reply_to" text,
	"email_from" text,
	"email_key_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitation_role_valid";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_customer_id_customer_profiles_user_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_driver_id_driver_profiles_user_id_fk";
--> statement-breakpoint
DROP INDEX "orders_customer_request_unique";
--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP CONSTRAINT "customer_profiles_pkey";
--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP CONSTRAINT "driver_profiles_pkey";
--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "produce" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "network_id" uuid;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "network_id" uuid;
--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD COLUMN "network_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_network_id_user_id_pk" PRIMARY KEY("network_id","user_id");
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_network_id_user_id_pk" PRIMARY KEY("network_id","user_id");
--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "produce" ADD CONSTRAINT "produce_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "market_schedules_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_network_identity" UNIQUE("network_id","id");
--> statement-breakpoint
ALTER TABLE "network_memberships" ADD CONSTRAINT "network_memberships_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "network_memberships" ADD CONSTRAINT "network_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "produce" ADD CONSTRAINT "produce_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "produce" ADD CONSTRAINT "produce_farm_id_network_fk" FOREIGN KEY ("network_id","farm_id") REFERENCES "public"."farms"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_network_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD CONSTRAINT "background_job_runs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_run_id_network_fk" FOREIGN KEY ("network_id","run_id") REFERENCES "public"."market_runs"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_produce_id_network_fk" FOREIGN KEY ("network_id","produce_id") REFERENCES "public"."produce"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_market_id_network_fk" FOREIGN KEY ("network_id","market_id") REFERENCES "public"."markets"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_schedule_id_network_fk" FOREIGN KEY ("network_id","schedule_id") REFERENCES "public"."market_schedules"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "market_schedules_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "market_schedules_market_id_network_fk" FOREIGN KEY ("network_id","market_id") REFERENCES "public"."markets"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_network_fk" FOREIGN KEY ("network_id","order_id") REFERENCES "public"."orders"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_network_fk" FOREIGN KEY ("network_id","order_id") REFERENCES "public"."orders"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_inventory_id_network_fk" FOREIGN KEY ("network_id","inventory_id") REFERENCES "public"."inventory"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_farm_id_network_fk" FOREIGN KEY ("network_id","farm_id") REFERENCES "public"."farms"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_run_id_network_fk" FOREIGN KEY ("network_id","run_id") REFERENCES "public"."market_runs"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_network_fk" FOREIGN KEY ("network_id","customer_id") REFERENCES "public"."customer_profiles"("network_id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_network_fk" FOREIGN KEY ("network_id","driver_id") REFERENCES "public"."driver_profiles"("network_id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_order_item_id_network_fk" FOREIGN KEY ("network_id","order_item_id") REFERENCES "public"."order_items"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_schedule_id_network_fk" FOREIGN KEY ("network_id","schedule_id") REFERENCES "public"."market_schedules"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_produce_id_network_fk" FOREIGN KEY ("network_id","produce_id") REFERENCES "public"."produce"("network_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_request_unique" ON "orders" USING btree ("network_id","customer_id","request_id");
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_role_valid" CHECK ("invitations"."role" IN ('customer','driver','network_admin'));
--> statement-breakpoint
-- Preserve existing access while making administrator scope explicit.
INSERT INTO user_roles (user_id, role) SELECT user_id, 'global_admin' FROM user_roles WHERE role = 'admin' ON CONFLICT DO NOTHING;
DELETE FROM user_roles WHERE role = 'admin';
--> statement-breakpoint
-- Network-scoped list, queue, and history access paths.
CREATE INDEX "produce_network_farm_idx" ON "produce" USING btree ("network_id","farm_id");--> statement-breakpoint
CREATE INDEX "api_tokens_network_user_created_idx" ON "api_tokens" USING btree ("network_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_network_started_idx" ON "background_job_runs" USING btree ("network_id","started_at");--> statement-breakpoint
CREATE INDEX "inventory_network_produce_idx" ON "inventory" USING btree ("network_id","produce_id");--> statement-breakpoint
CREATE INDEX "invitations_network_created_idx" ON "invitations" USING btree ("network_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_network_start_idx" ON "market_runs" USING btree ("network_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "runs_network_end_idx" ON "market_runs" USING btree ("network_id","ends_at");--> statement-breakpoint
CREATE INDEX "orders_network_created_idx" ON "orders" USING btree ("network_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_network_customer_created_idx" ON "orders" USING btree ("network_id","customer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_network_driver_run_idx" ON "orders" USING btree ("network_id","driver_id","run_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_network_run_created_idx" ON "orders" USING btree ("network_id","run_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_available_network_run_idx" ON "orders" USING btree ("network_id","run_id","created_at","id") WHERE "orders"."status" = 'placed' AND "orders"."driver_id" IS NULL;--> statement-breakpoint
CREATE INDEX "schedule_inventory_network_produce_idx" ON "schedule_inventory" USING btree ("network_id","produce_id");--> statement-breakpoint
CREATE INDEX "network_memberships_user_network_idx" ON "network_memberships" USING btree ("user_id","network_id");
