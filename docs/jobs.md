# Schedules and background jobs

[Documentation](README.md) · [Project README](../README.md)

## Recurring schedules

The UI and MCP call the same business operations and produce audit events. A market run represents one specific date. Persistent `market_schedules` store weekday (Sunday=0), local opening/closing times in minutes after midnight, cutoff lead time, delivery delay after opening, delivery duration/fee, active status, and an optional Thanksgiving exclusion. `schedule_inventory` stores default stock and prices for new dates.

The scheduling job prepares four upcoming orderable dates per active schedule. Customer, driver, administrator, and MCP run-list queries are read-only. The customer page refreshes every minute and shows market dates within the next 14 days whose cutoff is still ahead. PostgreSQL computes local dates in the market timezone, including daylight saving. Cancelled dates stay cancelled; the job fills the buffer with subsequent weeks instead. Disabling a schedule stops generation but does not cancel existing runs.

Use **Operations → Markets → Recurring weekly schedules**, or MCP tools `list_schedules`, `save_schedule`, and `save_schedule_inventory`, to manage recurrence. Changes affect newly created runs only. Inventory edits on a generated run default to saving the same prices/quantities for future dates; uncheck that option for a one-time change. Because four dates are prepared ahead, use per-run inventory edits to change dates that already exist. Existing runs, prices, reservations, and orders are never overwritten by the job.

## Job execution

The shared `generate-market-runs` job is used by the local worker, CLI, administrator retry, MCP, and protected HTTP endpoint. PostgreSQL advisory locks skip overlapping executions across processes; transactions and unique market/start constraints make retries safe. `background_job_runs` records running/succeeded/failed/skipped status, timestamps, source, and creation counts. A failure rolls back generated runs and retains its failed attempt record. Abrupt process termination can leave a `running` history row; the transaction lock is released when its connection closes. Operations shows recent attempts and a **Run scheduling job now** button. MCP also offers `run_scheduling_job` and `list_job_runs`.

### Local development

`npm run dev` applies pending migrations before starting the frontend, API, and a separate cron worker. A migration failure stops startup before the worker can change an incompatible database. The worker runs both jobs on startup: market generation then runs daily at **12:00 UTC** (5 a.m. PDT / 4 a.m. PST), and market closing runs every minute. It runs independently of page views while the development process is running.

```sh
npm run db:migrate
npm run jobs:run      # Run once; also useful after deployment or schedule changes
npm run jobs:worker   # Standalone worker, if web/API run separately
npm run jobs:close    # Reconcile closed markets now
npm run dev:apps      # Web/API only, without the worker
```

The seed invokes the same job once to initialize demo dates. Tests disable the local worker and explicitly invoke jobs against the isolated test database. Do not run the local worker alongside a production managed scheduler unless you intend redundant invocations (the database lock still prevents overlap).

### Vercel Cron

`vercel.json` at the repository root declares a daily `0 12 * * *` invocation of `GET /internal/jobs/market-runs` on the shared project domain. A second cron invokes `/internal/jobs/close-markets` every minute. Top-level rewrites route both exact paths to the `api` service; the word `internal` in the path does not make it private. Set a separate cryptographically random `CRON_SECRET` of at least 32 characters in the project environment. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; the endpoint rejects missing/invalid credentials, fails closed if unconfigured, and sends `Cache-Control: no-store`. It never trusts a cron user-agent or browser session.

The minute-level closing cron requires Vercel Pro/Enterprise; Hobby rejects that cron at deployment. To remain on Hobby, remove the minute cron from `vercel.json` and configure an external scheduler to call the protected closing endpoint every minute (or run the standalone worker elsewhere). No plan upgrade is performed by this code. Vercel cron runs on production deployments; `vercel dev` does not schedule it. See [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Deploy the API (startup applies migrations), run `npm run jobs:run` once with deployment database credentials, and confirm the cron appears in the project's Cron Jobs settings. The checked-in configuration is ready for deployment, but no Vercel project or live production cron has been provisioned from this checkout. Failed invocations are visible in Vercel/API logs and the Operations job history; use the manual retry after fixing the cause. Other hosts can schedule `npm run jobs:run` or call the protected endpoint with the same bearer header. Keep secrets in your host's secret store, never in committed cron command files.

## Unfulfilled orders at market closing

The `close-expired-markets` job uses the stored market closing time. It cancels only orders that have not started shopping (`placed` or `claimed`), releases their reservations, and adds one system event. Repeated/overlapping jobs do not duplicate cancellation events. A closed market cannot accept new claims or shopping starts.

Orders already `shopping`, `ready`, `out_for_delivery`, or `delivery_failed` remain active. Drivers can finish recording purchases, finalize shopping, deliver and retry after closing. Market dates become completed after closing once no active fulfillment remains. Delivery windows may extend past market closing; the recurring schedule's delivery start must still fall within market hours. Unresolved shopping or failed deliveries remain visible for manual recovery rather than silently discarding purchased food.

## Related guides

- [Customer and driver workflows](workflows.md)
- [MCP scheduling tools](mcp.md)
- [Deployment](deployment.md)
