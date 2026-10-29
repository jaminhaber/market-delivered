# Scheduling and jobs

The platform retains recurring market generation and automatic closing. Networks
own schedules, inventory defaults, generated market runs, and job history.
Generation preserves existing runs/orders; closing expires unshopped orders while
allowing already-started fulfillment to finish. Jobs acquire database locks to
avoid overlapping work and record failures for retry.

Each run stores `impactedEntities`: market dates created or closed, plus orders
cancelled. Checking schedules, locking rows, and writing job/audit history do not
count. The value is committed with the business changes; skipped, rolled-back,
and otherwise empty runs remain zero. Migration `0005_job_impacts` initializes
all existing history to zero rather than reconstructing old counts.

The Jobs page, `admin.jobs`, and MCP `list_job_runs` hide zero-impact runs by
default, filtering before the 20-row limit. Use the page's **Include empty runs**
toggle or API/MCP `includeEmpty: true` to inspect empty, failed, skipped, running,
or backfilled historical runs. The page toggle updates automatically.

`npm run dev` runs a local worker: generation daily at 12:00 UTC, closing every
minute, and both once on startup. Run manually with:

```sh
npm run jobs:run
npm run jobs:close
```

Business MCP can run jobs within its bound network. Platform scheduled jobs iterate
networks explicitly; an empty platform safely skips work.

On Vercel, only the shared backend project's cron configuration schedules these jobs.
Do not run the local worker against the same production database. The protected
GET endpoints are `/internal/jobs/market-runs` and `/internal/jobs/close-markets`;
they require `Authorization: Bearer <CRON_SECRET>` and are not exposed by the admin
project or Silverstreak. Cron runs only on production deployments. Configure a
separate staging database when verifying schedules.
