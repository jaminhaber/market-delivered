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
	CONSTRAINT "market_schedule_valid" CHECK ("market_schedules"."weekday" BETWEEN 0 AND 6 AND "market_schedules"."opens_minute" BETWEEN 0 AND 1439 AND "market_schedules"."closes_minute" > "market_schedules"."opens_minute" AND "market_schedules"."closes_minute" <= 1440 AND "market_schedules"."cutoff_minutes" BETWEEN 0 AND 10080 AND "market_schedules"."delivery_delay_minutes" BETWEEN 0 AND 1440 AND "market_schedules"."delivery_duration_minutes" BETWEEN 1 AND 1440 AND "market_schedules"."delivery_fee_cents" BETWEEN 0 AND 100000)
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
ALTER TABLE "market_runs" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "market_schedules_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_schedule_id_market_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."market_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_inventory" ADD CONSTRAINT "schedule_inventory_produce_id_produce_id_fk" FOREIGN KEY ("produce_id") REFERENCES "public"."produce"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_schedule_weekday_unique" ON "market_schedules" USING btree ("market_id","weekday");--> statement-breakpoint
ALTER TABLE "market_runs" ADD CONSTRAINT "market_runs_schedule_id_market_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."market_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Enable recurrence for existing Ojai installations without rerunning demo seed.
INSERT INTO market_schedules (id, market_id, weekday, opens_minute, closes_minute, skip_thanksgiving)
SELECT '00000000-0000-4000-8004-000000000010'::uuid, id, 4, 900, 1140, true
FROM markets WHERE id = '00000000-0000-4000-8002-000000000010'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO market_schedules (id, market_id, weekday, opens_minute, closes_minute, skip_thanksgiving)
SELECT '00000000-0000-4000-8004-000000000011'::uuid, id, 0, 540, 780, false
FROM markets WHERE id = '00000000-0000-4000-8002-000000000011'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO schedule_inventory (schedule_id, produce_id, price_cents, quantity, active)
SELECT DISTINCT ON (ms.id, i.produce_id) ms.id, i.produce_id, i.price_cents, i.quantity, i.active
FROM market_schedules ms
JOIN market_runs r ON r.market_id = ms.market_id
JOIN inventory i ON i.run_id = r.id
WHERE ms.id IN ('00000000-0000-4000-8004-000000000010', '00000000-0000-4000-8004-000000000011')
ORDER BY ms.id, i.produce_id, r.starts_at DESC
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE market_runs r SET schedule_id = ms.id
FROM market_schedules ms
WHERE ms.market_id = r.market_id AND r.id IN ('00000000-0000-4000-8003-000000000010', '00000000-0000-4000-8003-000000000011') AND r.schedule_id IS NULL;
