ALTER TABLE "orders" ADD COLUMN "cash_collected_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_recorded_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cash_recorded_by_users_id_fk" FOREIGN KEY ("cash_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE orders o SET actual_total_cents = (
  SELECT COALESCE(SUM(oi.fulfilled_quantity * oi.price_cents), 0)
  FROM order_items oi WHERE oi.order_id = o.id
) + o.delivery_fee_cents
WHERE o.status IN ('ready', 'out_for_delivery', 'delivery_failed', 'delivered') AND o.actual_total_cents IS NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_cash_valid" CHECK ("orders"."cash_collected_cents" >= 0 AND "orders"."cash_collected_cents" <= coalesce("orders"."actual_total_cents", 0));
