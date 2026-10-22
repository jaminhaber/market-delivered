# Market Delivered

An invite-only neighborhood market service built with React, Vite, Fastify, tRPC, Better Auth, Drizzle, and PostgreSQL. Customers order ahead of a dated farmers market run. An approved driver shops the combined list, records actual costs and shortages, and makes individual deliveries. Customers pay cash using the prices entered by operations. Cash collection is recorded manually.

## Run locally

Requires Node 22.12+, npm, and Docker Desktop.

```sh
npm install
cp .env.example .env
# Replace BETTER_AUTH_SECRET with a cryptographically random secret, at least 32 characters.
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:5173> or <http://127.0.0.1:5173>. Development auth and API origin checks accept both loopback hostnames on the configured frontend port; production trusts only its configured origin. The API runs on port 3001; Vite proxies `/trpc` and `/api/auth`. The seed preserves existing records and adds 12 catalog items, source-vendor metadata, and the next Thursday and Sunday Ojai market runs with inventory. No sample accounts or production credentials are created.

Ojai seed schedules (Pacific time, verified October 21, 2026):

- [Ojai Community Farmers Market](https://www.ojaicommunityfarmersmarket.com/location): Thursdays, 3–7 p.m., 414 E. Ojai Avenue. The seed skips Thanksgiving, per the [operator FAQ](https://www.ojaicommunityfarmersmarket.com/faqs-1-1).
- [Ojai Certified Farmers Market](https://www.ojairotie.com/journal/farmers-market): Sundays, 9 a.m.–1 p.m., 300 E. Matilija Street.

Each seed run uses a sample cutoff 12 hours before opening, a delivery window during market opening hours, and a $5 delivery fee. These are our app defaults, not policies of the market operators. Dates follow `America/Los_Angeles` daylight saving rules. The seed initializes persistent schedules and inventory defaults. The scheduling job creates upcoming dates independently of page visits; re-seeding is unnecessary. Existing runs, orders, and inventory are preserved. The original Sonoma demo is replaced only if it has no orders or assigned driver. The example vendor names and produce/prices are fictional; they do not assert actual vendor participation or availability.

Bootstrap your own administrator account:

```sh
npm run invite:create -- you@example.com customer
# Open the printed invitation URL and create your account.
npm run admin:grant -- you@example.com
# Refresh the app to see Operations.
```

Use **Operations → People** to create customer or approved-driver invitations. Share each link with its intended recipient. Invitations expire after 7 days, prefill a read-only signup email and work only with their specified email, can be revoked, and cannot be reused for another account. Open signup is blocked server-side. The trusted local CLI also supports `npm run invite:create -- driver@example.com driver`.

## Application flows

### Customers

Accept an invitation, sign in, and save a delivery profile with a name, phone number, address, and instructions. Choose a market day and quantities from that run’s inventory. Addresses use required street, city, state, ZIP and country fields, with an optional apartment/unit. **Street address** provides debounced Google Places autocomplete, biased toward Ojai and restricted to US results. Choose a suggestion with the mouse or arrow keys and Enter to fill street, city, state and ZIP; apartment/unit is preserved. Suggestions and place details use a shared session token through authenticated backend endpoints; the key stays on the server. Enable **Places API (New)** and add it to the key’s API restrictions alongside Address Validation. Manual entry remains available if suggestions fail. PostgreSQL-backed per-user limits allow 60 autocomplete requests, 10 detail requests, and 10 validation requests per minute, independently across API instances. Provider errors also count toward these limits. Set provider-side quotas and billing alerts as a separate overall spend limit.

After saving, **Look up saved address** calls Google Address Validation from the server using `GOOGLE_MAPS_API_KEY`. Enable **Address Validation API** on that key’s Google Cloud project and configure billing and appropriate server key restrictions. The lookup sends the saved address (including unit) but excludes delivery instructions. Incomplete addresses are rejected by lookup; suggested corrections are displayed for the customer to review, enter and save before retrying. Manual delivery using the entered address remains available if lookup fails.

Google results are displayed for the current lookup with attribution. Only the Google place ID, provider and lookup time are persisted; Google-returned formatted addresses and coordinates are not stored. Customer-entered structured addresses and place IDs are snapshotted on orders. Editing the address clears its saved place ID. Legacy Census coordinates remain on existing records until edited or replaced.

Checkout reserves inventory transactionally and stores immutable price and delivery-detail snapshots. Each checkout request has an idempotency key. Customers can view only their own orders and cancel before the cutoff, releasing reservations.

Customers pay cash at the unit prices saved when the order is placed. Shortages reduce the total by the unfulfilled quantity; driver purchase costs do not change customer pricing. The assigned driver can manually record the cumulative cash collected and a note, including corrections or partial collection. Customers can see their collected and outstanding amounts.

### Drivers

Driver invitations grant an approved driver profile. Drivers save their name, phone and vehicle in the driver profile before claiming a run. A customer delivery address is optional and can be added separately if they want to place an order. Driver profiles are created only through team-issued driver invitations. Customers cannot apply or grant themselves driver access. Administrators can suspend access immediately. Operations → Markets can assign or replace a driver on an active run, or release a scheduled run back to the driver pool. In-progress runs require a replacement approved driver with complete contact and vehicle details. Reassignment preserves purchases, order allocations, delivery progress and cash records; the previous driver immediately loses run access. Coordinate the physical handoff of groceries and cash before reassigning.

For this small-scale launch, **one driver owns a whole market run**. Either driver can claim an unassigned run; simultaneous claims are serialized. Shopping starts only after both the cutoff and market opening. Customer delivery details are restricted to administrators and the assigned, approved driver.

The combined shopping list shows total reserved demand. Record purchased quantities and total costs for every item, using zero quantity and zero cost for unavailable items. Finishing shopping allocates produce to orders in placement order. Internal purchase-cost allocation preserves the exact recorded total in integer cents, including rounding. Customer totals use fulfilled quantities multiplied by their saved sale prices. Partially fulfilled orders keep their delivery fee; entirely unavailable orders have a zero final total and no delivery. Allocation is final once shopping is finished.

Drivers start each delivery, mark it delivered, or record a failed attempt with a reason. Failed deliveries can be retried. The market run completes only after all fulfillable orders are delivered. Status changes are recorded in each order’s history.

### Operations

Create market locations with IANA timezones, then schedule explicit dated runs with market hours, an order cutoff, a delivery window, and a delivery fee. The UI labels the device timezone used for date input; stored timestamps are absolute instants and customer schedules are shown in the market timezone.

Add catalog items with source/vendor information, and publish inventory and unit prices per run. Inventory is locked after cutoff, and quantities cannot be reduced below existing reservations. Price changes do not alter existing orders. Cancelling a scheduled run cancels its orders and releases reservations.

Manage invitations, driver approval/suspension, and MCP tokens. Administrator roles are assigned by the trusted CLI, never by public profile forms. New roles can be added in `user_roles` without changing `users`.

## Auth and email

Better Auth manages password hashing, database-backed sessions, sign-in, sign-out, email verification, and password resets. Customer and driver profiles point to the core `users` table; a person can have both profiles. Session cookies are HTTP-only and are secured by Better Auth for HTTPS deployments. API authorization and origin checks are enforced independently of UI navigation.

Local password-reset and verification links are printed to the API terminal instead of sending email. The reset UI is accessible from **Sign in → Forgot password?** Production requires `RESEND_API_KEY`, `EMAIL_FROM`, `BETTER_AUTH_SECRET`, and correct HTTPS `BETTER_AUTH_URL` / `WEB_ORIGIN`. Production signup requires email verification. Unverified sign-in attempts resend verification, and the sign-in/signup screen offers an explicit resend action (limited to five requests per IP per minute). Verification redirects back to the frontend, with secure HTTP-only sessions. Email requests time out after 10 seconds so provider outages cannot indefinitely hold an API request. Configure a verified Resend sender domain before inviting real users. No live email delivery has been configured in this checkout.

`GOOGLE_MAPS_API_KEY` configures server-side Google Address Validation. Set it in the root `.env` locally and in the API project’s environment when deployed. The key is never sent to the frontend.

Auth rate limits use PostgreSQL so they work across API processes. The isolated E2E server runs with `NODE_ENV=test` and disables auth rate limiting so repeated test-account setup does not exhaust it. Do not run a deployed app in test mode.

## Authenticated MCP

The API exposes a stateless Streamable HTTP MCP endpoint at <http://127.0.0.1:3001/mcp>.

1. Sign in as an administrator.
2. Open **Operations → MCP access** and create a named token.
3. Save the token immediately; the raw value is shown once.
4. Configure your MCP client with the endpoint and `Authorization: Bearer <token>`.

Tokens expire after 90 days, are stored only as SHA-256 hashes, and can be revoked. Each request also checks that the token owner still has administrator access. The integration uses explicitly configured bearer tokens; OAuth discovery and interactive OAuth login are not implemented.

Tools:

- `list_markets`, `get_market`, `update_market`: inspect/edit market locations; timezone changes are blocked after runs exist
- `list_runs`, `get_run`, `update_run`: inspect run settings and order counts; update only unbooked scheduled runs before cutoff. Moving a recurring opening date requires cancellation and a one-off replacement
- `list_produce`, `get_produce`, `update_produce`, `catalog_options`: inspect/edit catalog and per-item vendor metadata. Sale units cannot change after stock/defaults exist; catalog edits preserve existing order snapshots and run prices
- `list_orders`, `get_order`: read customer delivery snapshots, items, fulfillment history, run details and cash records. Lists accept `runId`, `marketId`, `customerId`, `status`, `from`/`to` (market opening time, inclusive/exclusive), and `limit`/`offset`; newest orders sort first. Both tools are read-only and require the same admin token
- `list_inventory`, `list_schedule_inventory`: read stock/defaults, including inactive items; run stock includes reserved and available quantities
- List tools for markets, runs, produce, schedules, and inventory accept `limit` (1–100, default 50) and `offset` (default 0), returning arrays. Advance offset by limit until a short/empty page. Runs filter by `marketId`, `status`, `from` (inclusive opening timestamp), and `to` (exclusive); active/upcoming work sorts before history. Catalog search supports `search`, `category`, and `sourceId`; markets support `search`; schedules support `marketId` and `active`
- `create_market` with name, address, and timezone
- `schedule_run` with `marketId`, offset-bearing ISO timestamps (`cutoffAt`, `startsAt`, `endsAt`, `deliveryStartAt`, `deliveryEndAt`), and `deliveryFeeCents`
- `save_inventory` with `runId`, `produceId`, `priceCents`, offered `quantity`, and `active`
- `create_produce` with catalog and source-vendor details
- `cancel_run`: only empty scheduled runs; MCP cannot cancel runs containing orders

Use `active: false` with `save_inventory` or `save_schedule_inventory` to remove an item from sale for a run or future dates; `save_schedule` with `active: false` pauses generation. Historical records are retained. MCP provides no tools to place, edit, cancel or fulfill orders, or change their cash records. Cancelling a booked run remains an app operation. Update tools require the complete market/catalog/run fields plus `id`, rather than partial patches.

The UI and MCP call the same business operations and produce audit events. A market run represents one specific date. Persistent `market_schedules` store weekday (Sunday=0), local opening/closing times in minutes after midnight, cutoff lead time, delivery delay after opening, delivery duration/fee, active status, and an optional Thanksgiving exclusion. `schedule_inventory` stores default stock and prices for new dates.

The scheduling job prepares four upcoming orderable dates per active schedule. Customer, driver, administrator, and MCP run-list queries are read-only. The customer page refreshes every minute and shows market dates within the next 14 days whose cutoff is still ahead. PostgreSQL computes local dates in the market timezone, including daylight saving. Cancelled dates stay cancelled; the job fills the buffer with subsequent weeks instead. Disabling a schedule stops generation but does not cancel existing runs.

Use **Operations → Markets → Recurring weekly schedules**, or MCP tools `list_schedules`, `save_schedule`, and `save_schedule_inventory`, to manage recurrence. Changes affect newly created runs only. Inventory edits on a generated run default to saving the same prices/quantities for future dates; uncheck that option for a one-time change. Because four dates are prepared ahead, use per-run inventory edits to change dates that already exist. Existing runs, prices, reservations, and orders are never overwritten by the job.

## Scheduled job infrastructure

The shared `generate-market-runs` job is used by the local worker, CLI, administrator retry, MCP, and protected HTTP endpoint. PostgreSQL advisory locks skip overlapping executions across processes; transactions and unique market/start constraints make retries safe. `background_job_runs` records running/succeeded/failed/skipped status, timestamps, source, and creation counts. A failure rolls back generated runs and retains its failed attempt record. Abrupt process termination can leave a `running` history row; the transaction lock is released when its connection closes. Operations shows recent attempts and a **Run scheduling job now** button. MCP also offers `run_scheduling_job` and `list_job_runs`.

### Local development

`npm run dev` starts the frontend, API, and a separate cron worker. The worker runs once on startup, then daily at **12:00 UTC** (5 a.m. PDT / 4 a.m. PST). It runs independently of page views while the development process is running.

```sh
npm run db:migrate
npm run jobs:run      # Run once; also useful after deployment or schedule changes
npm run jobs:worker   # Standalone worker, if web/API run separately
npm run dev:apps      # Web/API only, without the worker
```

The seed invokes the same job once to initialize demo dates. Tests disable the local worker and explicitly invoke jobs against the isolated test database. Do not run the local worker alongside a production managed scheduler unless you intend redundant invocations (the database lock still prevents overlap).

### Vercel Cron

`apps/api/vercel.json` declares a daily `0 12 * * *` invocation of `GET /internal/jobs/market-runs` on the **API project**, with `apps/api` selected as its root directory. Configure the project to include workspace files outside that directory. Set a separate cryptographically random `CRON_SECRET` of at least 32 characters in the API environment. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; the endpoint rejects missing/invalid credentials, fails closed if unconfigured, and sends `Cache-Control: no-store`. It never trusts a cron user-agent or browser session.

The daily cadence works with Vercel Hobby's once-daily cron limit; its scheduling precision is hourly, so the four-date buffer avoids depending on an exact invocation minute. Vercel cron runs on production deployments; `vercel dev` does not schedule it. See [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Deploy the API, apply migrations, run `npm run jobs:run` once with deployment database credentials, and confirm the cron appears in the project's Cron Jobs settings. The checked-in configuration is ready for deployment, but no Vercel project or live production cron has been provisioned from this checkout. Failed invocations are visible in Vercel/API logs and the Operations job history; use the manual retry after fixing the cause. Other hosts can schedule `npm run jobs:run` or call the protected endpoint with the same bearer header. Keep secrets in your host's secret store, never in committed cron command files.

## Schema and workspace

```text
apps/web       React screens and typed API client
apps/api       Auth handler, tRPC, MCP, queries, transactional operations
packages/db    Schema, SQL migrations, seed, connection factory
scripts        Trusted administrator bootstrap and isolated E2E startup
tests/e2e      Browser and HTTP integration tests
```

The schema covers users, auth accounts/sessions/verifications/rate limits, customer profiles, driver profiles, extensible roles, invitations, markets, dated market runs, run inventory, orders, order-item snapshots, purchases, order history, MCP tokens, and operations audit events. Existing `farms` records now serve as catalog source metadata; there is no farmer onboarding flow.

Database constraints enforce foreign keys, unique reservations/items/request keys, valid run dates, nonnegative money, and inventory bounds. Run-row locks serialize checkout, cancellation, inventory edits, driver claims, shopping, and delivery transitions. All money is integer USD cents; quantities are whole sale units such as bunches, baskets, or pounds. Fractional weights are not supported yet.

To change the schema, edit the files under `packages/db/src`, run `npm run db:generate`, review the SQL and metadata, and run `npm run db:migrate`. Drizzle maintains ORM update timestamps; direct SQL writers must maintain those fields themselves. Apply migrations as a deployment step rather than on every API process startup.

## Checks and E2E tests

```sh
npm run typecheck
npm run typecheck:e2e
npm run format:check
npm run build

npm run test:db
npx playwright install chromium
npm run test:e2e
```

Tests start their own web/API servers on ports 5180/3101 and use a separate PostgreSQL container on port 5433 with a temporary filesystem. Override `E2E_DATABASE_URL` only with an isolated database whose name ends in `_e2e`; the runner refuses other names. Tests reset only this isolated test database at startup, create uniquely named fixtures, and never truncate development data. Failure screenshots, traces, and an HTML report are ignored by Git.

The suite covers production verification/resend with a stubbed email provider, secure session cookies, production configuration validation, atomic address request limits, administrator driver reassignment, real invite-only signup and sessions, profile persistence, administrator UI, customer checkout, driver shopping and delivery (including shortages and retry), concurrent stock reservation, idempotency, cancellation, cutoff enforcement, authorization, immutable order snapshots, and authenticated MCP tools/token lifecycle. GitHub Actions runs these checks against PostgreSQL and Chromium.

## Deployment

Build with `npm ci && npm run build`, run migrations with deployment database credentials, and start the API with `NODE_ENV=production npm run start:api`. Serve `apps/web/dist` as static assets and route `/trpc` and `/api/auth` to the API on the same public origin. Same-origin hosting is recommended for session cookies.

For separate hosts, set `VITE_API_URL` and `VITE_AUTH_URL` at frontend build time and configure the exact `WEB_ORIGIN` and public `BETTER_AUTH_URL`. Cross-site cookie policy requires additional deployment-specific configuration; it is not enabled by default. Use the database provider’s TLS configuration, and do not disable certificate verification. Set `API_HOST=0.0.0.0` for containers. Scoped esbuild overrides keep migration/build dependencies patched.

The API includes structured logging with credential redaction, connection pooling, graceful shutdown, `/health` liveness, and `/ready` database readiness. On Vercel the pool is attached to the platform lifecycle so idle connections can drain before instance suspension. Use a hosted PostgreSQL pooler compatible with transactions and size the provider connection budget for multiple API instances (up to 10 connections each).

### Vercel test deployment

Use two projects from this workspace. In both projects enable access to workspace files outside the selected root directory, use Node 22, and install from the workspace lockfile. The frontend uses `apps/web/vercel.ts` to proxy auth and tRPC to the API; this keeps browser cookies on the frontend origin. Vercel supports [programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts) and [external rewrites](https://vercel.com/docs/routing/rewrites).

| Project | Root       | Build           | Output                                     |
| ------- | ---------- | --------------- | ------------------------------------------ |
| API     | `apps/api` | `npm run build` | Fastify preset (no static output override) |
| Web     | `apps/web` | `npm run build` | `dist`                                     |

Set environment variables in the relevant Vercel environment, then redeploy:

| Variable                       | Project | Value                                                                             |
| ------------------------------ | ------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | API     | Hosted **test** PostgreSQL database URL with the provider's verified TLS settings |
| `BETTER_AUTH_SECRET`           | API     | Random secret, at least 32 characters                                             |
| `CRON_SECRET`                  | API     | A different random secret, at least 32 characters                                 |
| `WEB_ORIGIN`                   | API     | Exact public HTTPS frontend origin, such as `https://market-test.example.com`     |
| `BETTER_AUTH_URL`              | API     | The same **frontend** origin; auth requests reach the API through the web proxy   |
| `RESEND_API_KEY`, `EMAIL_FROM` | API     | Working Resend credentials and verified sender                                    |
| `GOOGLE_MAPS_API_KEY`          | API     | Optional key with Places API (New) and Address Validation enabled                 |
| `API_ORIGIN`                   | Web     | HTTPS origin of the API project, with no path, credentials, query or fragment     |

Leave `VITE_API_URL` and `VITE_AUTH_URL` unset for this setup. Production startup rejects missing HTTPS origins, example secrets and incomplete Vercel auth/cron settings. Use a stable frontend alias for testing; a different preview URL needs its own matching API origin configuration. The API deployment must accept proxy traffic: if Vercel Deployment Protection blocks it, configure access before testing the frontend. Do not share preview/staging databases or auth secrets with a real production service.

Apply migrations to the hosted test database before sending traffic. From the workspace root, with deployment variables exported in the shell:

```sh
npm run db:migrate
npm run db:seed         # Optional: fictional Ojai catalog and schedules for testing
npm run jobs:run
npm run invite:create -- you@example.com customer
# Create and verify your account through the printed frontend invitation URL.
npm run admin:grant -- you@example.com
```

Shell-exported deployment variables take precedence over the local `.env`. Do not overwrite local development settings with production credentials or run database resets against a hosted database. Migrations are a deliberate release step; API startup never migrates automatically.

Before inviting testers, verify `/ready` on the API and these flows through the **frontend URL**: invitation signup → delivered verification email → verified session → sign-out/sign-in; verification resend; password reset; profile save; checkout/cancellation; driver claim/shopping/delivery; and Operations driver reassignment. Confirm `/trpc/me` traffic goes through the frontend proxy and session cookies are Secure and HTTP-only. Verify Google autocomplete/validation with the deployed key if enabled. Run the scheduling job manually for preview tests: Vercel cron only schedules production deployments. For a dedicated test project deployed to its production environment, verify the daily cron in Vercel and Operations history.

Local checks validate code and isolated database behavior; hosted email delivery, Vercel routing/protection, provider TLS and managed cron execution still require this deployment smoke check. No hosted project or credentials are provisioned by the repository.

Before a larger launch, define delivery service areas, address validation, pricing/fee rules, notifications, and operational procedures for driver handoffs. Routing optimization, multi-driver splitting within a run, automatic payment settlement, fractional weights, and receipt uploads remain future work. Run lists prioritize shopping/delivery work, then upcoming scheduled runs, ahead of history. Lists currently cap at 100 records; cursor pagination should accompany growth beyond the invite-only launch.

To clear all local development users, sessions, invitations, orders and catalog data and reseed Ojai, stop the dev processes and run `npm run db:reset:local`, then restart `npm run dev`. The reset refuses production mode, remote hosts and database names other than `market_delivered`. You will need a new invitation afterward; existing accounts and invitation links are removed.
