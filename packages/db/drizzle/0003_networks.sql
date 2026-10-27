-- Network ownership, isolation, branding, support, location and email settings.
-- Upgrade from the existing 0000–0002 migration history without recreating tables.
CREATE TABLE "network_memberships" (
	"network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
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
-- Existing operational rows receive this network through the new column defaults.
INSERT INTO networks (id, name, slug, location)
VALUES ('00000000-0000-4000-8000-000000000001', 'Ojai', 'ojai',
'{"city":"Ojai","region":"CA","postalCode":"93023","timezone":"America/Los_Angeles","autocompleteBias":{"latitude":34.448,"longitude":-119.243,"radiusMeters":30000}}'::jsonb);
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
ALTER TABLE "farms" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "produce" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_runs" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD COLUMN "network_id" uuid DEFAULT coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL;
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
INSERT INTO network_memberships (network_id, user_id, role)
SELECT '00000000-0000-4000-8000-000000000001', u.id,
  CASE WHEN EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin') THEN 'network_admin' ELSE 'member' END
FROM users u;
INSERT INTO user_roles (user_id, role) SELECT user_id, 'global_admin' FROM user_roles WHERE role = 'admin' ON CONFLICT DO NOTHING;
DELETE FROM user_roles WHERE role = 'admin';
--> statement-breakpoint
-- Requires CREATEROLE on first install (or a pre-provisioned NOLOGIN role).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_network') THEN
    CREATE ROLE market_network NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_network' AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON c.relowner = r.oid WHERE r.rolname = 'market_network' AND c.relnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'market_network must be a restricted NOLOGIN, NOBYPASSRLS role without application table ownership';
  END IF;
  -- Hosted databases may provision membership without granting role administration.
  IF NOT pg_has_role(current_user, 'market_network', 'MEMBER') THEN
    EXECUTE format('GRANT market_network TO %I', current_user);
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO market_network;
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON farms TO market_network;
CREATE POLICY network_isolation ON farms TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE produce ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON produce TO market_network;
CREATE POLICY network_isolation ON produce TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON markets TO market_network;
CREATE POLICY network_isolation ON markets TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE market_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_runs TO market_network;
CREATE POLICY network_isolation ON market_runs TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE market_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_schedules TO market_network;
CREATE POLICY network_isolation ON market_schedules TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory TO market_network;
CREATE POLICY network_isolation ON inventory TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO market_network;
CREATE POLICY network_isolation ON orders TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO market_network;
CREATE POLICY network_isolation ON order_items TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchases TO market_network;
CREATE POLICY network_isolation ON purchases TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_events TO market_network;
CREATE POLICY network_isolation ON order_events TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_profiles TO market_network;
CREATE POLICY network_isolation ON customer_profiles TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON driver_profiles TO market_network;
CREATE POLICY network_isolation ON driver_profiles TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO market_network;
CREATE POLICY network_isolation ON invitations TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_tokens TO market_network;
CREATE POLICY network_isolation ON api_tokens TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_events TO market_network;
CREATE POLICY network_isolation ON audit_events TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE schedule_inventory ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_inventory TO market_network;
CREATE POLICY network_isolation ON schedule_inventory TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE background_job_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON background_job_runs TO market_network;
CREATE POLICY network_isolation ON background_job_runs TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid)
 WITH CHECK (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE network_memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON network_memberships TO market_network;
CREATE POLICY network_isolation ON network_memberships FOR SELECT TO market_network
 USING (network_id = nullif(current_setting('app.network_id', true), '')::uuid);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON users TO market_network;
GRANT UPDATE (name, updated_at) ON users TO market_network;
CREATE POLICY network_people ON users FOR SELECT TO market_network
 USING (id = current_setting('app.user_id', true) OR EXISTS (SELECT 1 FROM network_memberships m WHERE m.user_id = users.id));
CREATE POLICY own_name ON users FOR UPDATE TO market_network
 USING (id = current_setting('app.user_id', true)) WITH CHECK (id = current_setting('app.user_id', true));

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON auth_rate_limits TO market_network;
CREATE POLICY own_address_limits ON auth_rate_limits TO market_network
 USING (key LIKE 'address:' || current_setting('app.network_id', true) || ':%:' || current_setting('app.user_id', true))
 WITH CHECK (key LIKE 'address:' || current_setting('app.network_id', true) || ':%:' || current_setting('app.user_id', true));
