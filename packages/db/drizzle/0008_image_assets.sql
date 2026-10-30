CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"cloudflare_image_id" text NOT NULL,
	"filename" text NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_cloudflare_image_id_unique" UNIQUE("cloudflare_image_id"),
	CONSTRAINT "assets_image_type" CHECK ("assets"."type" = 'image'),
	CONSTRAINT "assets_metadata_object" CHECK (jsonb_typeof("assets"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_network_created_idx" ON "assets" USING btree ("network_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_network_produce_unique" ON "assets" USING btree ("network_id",("metadata"->>'produce_id')) WHERE "assets"."metadata" ? 'produce_id';