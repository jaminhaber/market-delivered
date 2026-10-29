# Scheduling and jobs

The platform retains recurring market generation and automatic closing. Networks
own schedules, inventory defaults, generated market runs, and job history.
Generation preserves existing runs/orders; closing expires unshopped orders while
allowing already-started fulfillment to finish. Jobs acquire database locks to
avoid overlapping work and record failures for retry.

`npm run dev` runs a local worker: generation daily at 12:00 UTC, closing every
minute, and both once on startup. Run manually with:

```sh
npm run jobs:run
npm run jobs:close
```

Business MCP can run jobs within its bound network. Platform scheduled jobs iterate
networks explicitly; an empty platform safely skips work.

On Vercel, only the public API project's cron configuration schedules these jobs.
Do not run the local worker against the same production database. The protected
GET endpoints are `/internal/jobs/market-runs` and `/internal/jobs/close-markets`;
they require `Authorization: Bearer <CRON_SECRET>` and are not exposed by the admin
project or Silverstreak. Cron runs only on production deployments. Configure a
separate staging database when verifying schedules.
