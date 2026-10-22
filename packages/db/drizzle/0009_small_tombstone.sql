-- Delivery delays are now measured from opening rather than closing.
-- Fit existing schedule settings inside market hours before enforcing the new constraint.
UPDATE market_schedules
SET delivery_delay_minutes = LEAST(delivery_delay_minutes, closes_minute - opens_minute - 1),
    delivery_duration_minutes = LEAST(delivery_duration_minutes, closes_minute - opens_minute - LEAST(delivery_delay_minutes, closes_minute - opens_minute - 1));
--> statement-breakpoint
-- The initial Ojai defaults promise delivery throughout the market session.
UPDATE market_schedules SET delivery_duration_minutes = closes_minute - opens_minute
WHERE id IN ('00000000-0000-4000-8004-000000000010', '00000000-0000-4000-8004-000000000011')
  AND delivery_delay_minutes = 0 AND delivery_duration_minutes = 120;
--> statement-breakpoint
UPDATE market_runs r
SET delivery_start_at = r.starts_at + make_interval(mins => s.delivery_delay_minutes),
    delivery_end_at = r.starts_at + make_interval(mins => s.delivery_delay_minutes + s.delivery_duration_minutes)
FROM market_schedules s
WHERE r.schedule_id = s.id AND r.status = 'scheduled' AND r.ends_at > now();
--> statement-breakpoint
-- Align future manually scheduled runs that still use the previous after-market window.
UPDATE market_runs SET delivery_start_at = starts_at, delivery_end_at = ends_at
WHERE schedule_id IS NULL AND status = 'scheduled' AND ends_at > now()
  AND delivery_end_at > ends_at;
--> statement-breakpoint
ALTER TABLE "market_schedules" ADD CONSTRAINT "schedule_delivery_during_market" CHECK ("market_schedules"."delivery_delay_minutes" + "market_schedules"."delivery_duration_minutes" <= "market_schedules"."closes_minute" - "market_schedules"."opens_minute");