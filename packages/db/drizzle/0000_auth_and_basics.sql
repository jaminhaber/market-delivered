-- Authentication, profiles, access control, farms/catalog and market locations.
CREATE TYPE "public"."produce_category" AS ENUM('Vegetables', 'Fruit', 'Herbs');
--> statement-breakpoint
CREATE TYPE "public"."produce_unit" AS ENUM('lb', 'bunch', 'basket', 'each');
--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('pending', 'approved', 'suspended');
--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
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
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_four" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
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
	"delivery_notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"vehicle" text NOT NULL,
	"status" "driver_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"used_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_role_valid" CHECK ("invitations"."role" IN ('customer','driver'))
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "produce" ADD CONSTRAINT "produce_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "produce_farm_idx" ON "produce" USING btree ("farm_id");
--> statement-breakpoint
CREATE INDEX "produce_category_idx" ON "produce" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "auth_accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_idx" ON "auth_accounts" USING btree ("provider_id","account_id");
--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "auth_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth_verifications" USING btree ("identifier");
--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");
