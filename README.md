# Market Delivered

An invite-only neighborhood market delivery service built with React, Vite, Fastify, tRPC, Better Auth, Drizzle, and PostgreSQL. Customers order ahead of a dated farmers market run. Drivers accept invitations, complete their contact and vehicle details, and claim individual orders. Each driver shops that order, records actual costs and shortages, and delivers it to the customer. Customers pay cash using the prices entered by operations. Cash collection is recorded manually.

## Run locally

Requires Node 22.12+, npm, and Docker Desktop.

```sh
npm install
cp .env.example .env
# Replace BETTER_AUTH_SECRET with a cryptographically random secret, at least 32 characters.
npm run db:up
npm run db:setup
npm run dev
```

Open <http://localhost:5173> or <http://127.0.0.1:5173>. Development auth and API origin checks accept both loopback hostnames on the configured frontend port; production trusts only its configured origin. The API runs on port 3001; Vite proxies `/trpc` and `/api/auth`. The seed preserves existing records and adds 12 catalog items, source-vendor metadata, and the next Thursday and Sunday Ojai market runs with inventory. No sample accounts or production credentials are created.

Ojai seed schedules (Pacific time, verified October 21, 2026):

- [Ojai Community Farmers Market](https://www.ojaicommunityfarmersmarket.com/location): Thursdays, 3–7 p.m., 414 E. Ojai Avenue. The seed skips Thanksgiving, per the [operator FAQ](https://www.ojaicommunityfarmersmarket.com/faqs-1-1).
- [Ojai Certified Farmers Market](https://www.ojairotie.com/journal/farmers-market): Sundays, 9 a.m.–1 p.m., 300 E. Matilija Street.

Each seed run uses a sample cutoff 12 hours before opening, a delivery window during market opening hours, and a $5 delivery fee. These are our app defaults, not policies of the market operators. Dates follow `America/Los_Angeles` daylight saving rules. The seed initializes persistent schedules and inventory defaults. The scheduling job creates upcoming dates independently of page visits; re-seeding is unnecessary. Existing runs, orders, and inventory are preserved. The original Sonoma demo is replaced only if it has no orders. The example vendor names and produce/prices are fictional; they do not assert actual vendor participation or availability.

Bootstrap your own administrator account:

```sh
npm run invite:create -- you@example.com customer
# Open the printed invitation URL and create your account.
npm run admin:grant -- you@example.com
# Refresh the app to see Operations.
```

Customers and drivers need a valid, unexpired invitation matching their email to create an account. Invitations determine customer or approved-driver access; signup headers and profile forms cannot grant driver or administrator access. Administrators can suspend drivers; editing a suspended profile does not restore access.

Use **Operations → People** to create customer or approved-driver invitations. Share each link with its intended recipient. Invitations expire after 7 days, prefill a read-only signup email and work only with their specified email, can be revoked, and cannot be reused for another account. The trusted local CLI also supports `npm run invite:create -- driver@example.com driver`.

## Application flows

### Customers

Accept an invitation, sign in, and save a delivery profile with a name, phone number, address, and instructions. Choose a market day and quantities from that run’s inventory. Addresses use required street, city, state, ZIP and country fields, with an optional apartment/unit. **Street address** provides debounced Google Places autocomplete, biased toward Ojai and restricted to US results. Choose a suggestion with the mouse or arrow keys and Enter to fill street, city, state and ZIP; apartment/unit is preserved. Suggestions and place details use a shared session token through authenticated backend endpoints; the key stays on the server. Enable **Places API (New)** and add it to the key’s API restrictions alongside Address Validation. Manual entry remains available if suggestions fail. PostgreSQL-backed per-user limits allow 60 autocomplete requests, 10 detail requests, and 10 validation requests per minute, independently across API instances. Provider errors also count toward these limits. Set provider-side quotas and billing alerts as a separate overall spend limit.

After saving, **Look up saved address** calls Google Address Validation from the server using `GOOGLE_MAPS_API_KEY`. Enable **Address Validation API** on that key’s Google Cloud project and configure billing and appropriate server key restrictions. The lookup sends the saved address (including unit) but excludes delivery instructions. Incomplete addresses are rejected by lookup; suggested corrections are displayed for the customer to review, enter and save before retrying. Manual delivery using the entered address remains available if lookup fails.

Google results are displayed for the current lookup with attribution. Only the Google place ID, provider and lookup time are persisted; Google-returned formatted addresses and coordinates are not stored. Customer-entered structured addresses and place IDs are snapshotted on orders. Editing the address clears its saved place ID. Legacy Census coordinates remain on existing records until edited or replaced.

Checkout reserves inventory transactionally and stores immutable price and delivery-detail snapshots. Each checkout request has an idempotency key. Customers can view only their own orders and cancel before the cutoff, releasing reservations.

Customers pay cash at the unit prices saved when the order is placed. Shortages reduce the total by the unfulfilled quantity; driver purchase costs do not change customer pricing. The assigned driver can manually record the cumulative cash collected and a note, including corrections or partial collection. Customers can see their collected and outstanding amounts.

### Drivers

Accept a driver invitation and save your name, phone and vehicle before claiming individual orders. Customers cannot self-enroll as drivers. Administrators can suspend or restore access. Production accounts must verify their email before signing in.

The **Driver** dashboard has **Available orders** and **My orders**, with a market filter. The server groups orders by market and date, paginates five market dates at a time, and includes accurate counts plus the first 25 orders per date. **More orders** pages within a date without hiding other markets behind a large order list. Changing an order page clears its selections. On an available date, select individual orders or all shown orders and use **Claim selected** to send one server-side batch command. Each order remains individually assigned; different drivers can fulfill different orders from the same market date, and one driver can claim more than one order. The pool shows destination city/ZIP, unit count, order estimate and delivery fee. Customer names, street addresses, phone numbers and instructions remain restricted to the assigned driver and administrators. Drivers can claim and fulfill their own customer orders, which are labeled “Your order” in the driver dashboard and shopping views.

A claimed order can be released before shopping begins. Start shopping while the market is open; this does not wait for the market-wide order cutoff. Each order retains its own purchases and final total.

From **My orders**, use **Combined shopping list** on a market date to see every order assigned to you for that date, across all order pages. The list groups products by vendor, shows requested/bought/unrecorded/short quantities, vendor contact details, and shopping notes. Delivered orders are excluded from shopping totals. **Start shopping for all claimed orders** begins all your pending orders for that date.

Enter the total quantity and purchase cost for each product across orders still shopping. The form suggests shortage allocations in order-placement order; expand **Review allocations** to adjust each customer's quantity before saving. These are cumulative totals, including existing records, rather than an additional purchase. Each allocation stays within the ordered quantity. Costs are divided proportionally in exact integer cents, with rounding pennies assigned in placement order. Zero quantity requires zero cost. Purchases already finalized on other orders remain unchanged. Stale item membership or purchase versions reject the whole save; use **Refresh shopping list** and review before retrying.

**Finish shopping** finalizes every one of your shopping orders for that date together. Every item must have a purchase record, including zero for unavailable items; a missing record rolls back all finalization changes. Entirely unavailable orders have no delivery or payment due. Finalization can complete after market closing.

The **Packing checklist** then shows purchased quantities, vendor names, shortages, and delivery addresses by customer order. Check an item once its full purchased quantity is in the customer's bag. Checks are saved on the order item and survive refreshes and driver reassignment. Only the assigned, approved driver can update packing on ready or active-delivery orders; unavailable items cannot be marked packed. You can also continue shopping an individual order from **Open order**.

Customer totals use purchased quantities multiplied by the sale prices saved at checkout. Purchase costs do not change customer prices. Partially fulfilled orders retain their delivery fee; entirely unavailable orders have a zero final total and no delivery. Drivers record cash collected, start delivery, mark it delivered, or record a failed attempt with a reason. Failed deliveries can be retried. Shopping records, cash collection and delivery can be completed after the market closes.

**Operations → Orders** assigns or replaces a driver on an individual active order. In-progress orders require a replacement driver with complete details. Coordinate groceries and cash before reassigning. Existing purchases and delivery/cash progress are preserved, and the previous driver loses access to that order.

Driver API contracts:

- `driver.orderGroups({ view, marketId?, limit?, offset?, orderLimit? })`: returns `markets`, `totalGroups`, `hasMore`, and `nextOffset`. Each market includes date groups with their run and an initial order `page`. `limit` counts market dates (default 5, max 20); `orderLimit` bounds each date's initial orders (default 25, max 100).
- `driver.orders({ runId, view, limit?, offset? })`: returns `{ items, total, hasMore, nextOffset }` for one date. This replaces the previous flat cross-market order-list response; clients must supply `runId`.
- `driver.claimBatch({ runId, orderIds })`: accepts 1–100 unique order IDs for one market date. Returns one `results` entry per requested order, in request order: `claimed`, `already_claimed`, or `failed` with a stable `code` and readable `message`. Missing and cross-date IDs both return `NOT_FOUND`. Business conflicts affect only those selections; valid orders are claimed together in one database transaction. Authentication/driver failures reject the request; unexpected database failures roll the whole transaction back.
- `driver.claim({ id })`: retains the single-order contract and uses the same claim implementation. Retrying an order already owned by the caller, including after shopping or delivery, does not add duplicate claim events.
- `driver.shoppingList({ runId })`: returns all assigned, non-cancelled orders for one date, vendor/product totals and per-order allocations, without an order-page limit. Delivered orders appear only in packing history.
- `driver.startShoppingBatch({ runId })` / `driver.finishShoppingBatch({ runId })`: begin claimed orders or finalize shopping orders for that driver/date; retries do not duplicate status events.
- `driver.combinedPurchase({ runId, inventoryId, quantity, totalCostCents, allocations })`: saves one product's cumulative purchase across all that driver's currently shopping order lines. Each allocation includes `orderItemId`, `quantity`, and the nullable `expectedPurchaseUpdatedAt` from the shopping-list query. A maximum of 1,000 unique lines is accepted per save. Missing, stale, cross-date or reassigned lines reject the transaction. Exact-cent costs are stored on the individual purchases.
- `driver.setPacked({ orderId, orderItemId, packed })`: persists or clears an order-item packing check after shopping.

Claims hold a shared market-date lock, check the driver once, and lock selected order rows in ID order. Independent claims can proceed together; date cancellation/closing still acquire the exclusive date lock. Customer profile updates, driver details, invitations and token mutations also go through shared operations instead of writing directly in router handlers. Administrator invitation/token changes produce audit events. Invitation-only signup and driver enrollment are unchanged.

### Operations

Create market locations with IANA timezones, then schedule explicit dated runs with market hours, an order cutoff, a delivery window, and a delivery fee. The UI labels the device timezone used for date input; stored timestamps are absolute instants and customer schedules are shown in the market timezone.

Use **Operations → Farms** to create and edit reusable farms/vendors, contact phone numbers and shopping notes, or archive a farm. Archiving hides its offerings from new customer orders; existing orders preserve vendor snapshots and remain fulfillable. Use **Inventory** to add/edit catalog items linked to a farm and publish quantities and unit prices per market date. The inventory list includes hidden items and offers **Edit inventory**. Prices and stock used for checkout come from the dated inventory; legacy catalog price/quantity fields are not used. Inventory is locked after cutoff, and quantities cannot be reduced below existing reservations. Price changes do not alter existing orders. Cancelling a scheduled market date cancels orders that have not started shopping and releases reservations. A date containing orders already being fulfilled cannot be cancelled wholesale.

Manage invitations, driver approval/suspension, and MCP tokens. Administrator roles are assigned by the trusted CLI, never by public profile forms. New roles can be added in `user_roles` without changing `users`.

## Auth and email

Better Auth manages password hashing, database-backed sessions, sign-in, sign-out, email verification, and password resets. Customer and driver profiles point to the core `users` table; a person can have both profiles. Session cookies are HTTP-only and are secured by Better Auth for HTTPS deployments. API authorization and origin checks are enforced independently of UI navigation.

Local password-reset and verification links are printed to the API terminal instead of sending email. The reset UI is accessible from **Sign in → Forgot password?** Production requires `RESEND_API_KEY`, `EMAIL_FROM`, `BETTER_AUTH_SECRET`, and correct HTTPS `BETTER_AUTH_URL` / `WEB_ORIGIN`. Production signup requires email verification. Unverified sign-in attempts resend verification, and the sign-in/signup screen offers an explicit resend action (limited to five requests per IP per minute). Verification redirects back to the frontend, with secure HTTP-only sessions. Email requests time out after 10 seconds so provider outages cannot indefinitely hold an API request. Configure a verified Resend sender domain before inviting real users. No live email delivery has been configured in this checkout.

`GOOGLE_MAPS_API_KEY` configures server-side Google Address Validation. Set it in the root `.env` locally and in the shared Vercel project environment when deployed. The key is never sent to the frontend.

Auth rate limits use PostgreSQL so they work across API processes. The isolated E2E server runs with `NODE_ENV=test` and disables auth rate limiting so repeated test-account setup does not exhaust it. Do not run a deployed app in test mode.

## Authenticated MCP

The API exposes a stateless Streamable HTTP MCP endpoint at `/mcp`. **Operations → MCP access** displays the full endpoint for the current site (or the API host configured with `VITE_API_URL`). Local development proxies `/mcp` through the web server; the API is also available directly at <http://127.0.0.1:3001/mcp> with the default ports. Hosted clients need the deployed HTTPS endpoint rather than a localhost URL.

1. Sign in as an administrator.
2. Open **Operations → MCP access** and create a named token.
3. Save the token immediately; the raw value is shown once.
4. Configure your MCP client with the displayed endpoint, Streamable HTTP transport, and `Authorization: Bearer <token>`. The MCP access page includes a JSON configuration example; adapt it to your client's format. Use a client that supports custom headers or bearer tokens.
5. Connect and list markets to verify access. Opening the URL in a browser is not a connection test: this endpoint requires authenticated MCP POST requests and does not support the older SSE transport.

Tokens expire after 90 days, are stored only as SHA-256 hashes, and can be revoked. Each request also checks that the token owner still has administrator access. The integration uses explicitly configured bearer tokens; OAuth discovery and interactive OAuth login are not implemented.

Tools:

- `invite_user` with `email` and optional `role` (`customer` by default, or `driver`): create a seven-day invitation and email the signup link. Requires `RESEND_API_KEY` and `EMAIL_FROM`, even locally. The recipient must sign up using the invited email address; driver invitations grant approved driver access after signup. Success reports `emailStatus: "accepted"` when the provider accepts the message, not confirmed inbox delivery. Failed sends revoke the new invitation and return an error. Each call creates a new invitation, so do not repeat successful calls. Administrator invitations are not supported.
- `list_markets`, `get_market`, `update_market`: inspect/edit market locations; timezone changes are blocked after runs exist
- `list_runs`, `get_run`, `update_run`: inspect run settings and order counts; update only unbooked scheduled runs before cutoff. Moving a recurring opening date requires cancellation and a one-off replacement
- `list_farms`, `get_farm`, `create_farm`, `update_farm`: manage reusable farms/vendors, contact details, shopping notes and archive status. Use `active: false` to archive without deleting history.
- `list_produce`, `get_produce`, `update_produce`, `catalog_options`: inspect/edit catalog items linked by `farmId`. Farm and sale unit cannot change after stock/defaults exist; create a new catalog item. Existing order snapshots and run prices stay unchanged.
- `list_orders`, `get_order`: read customer delivery snapshots, items, fulfillment history, run details and cash records. Lists accept `runId`, `marketId`, `customerId`, `driverId`, `status`, `from`/`to` (market opening time, inclusive/exclusive), and `limit`/`offset`; newest orders sort first. Both tools are read-only and require the same admin token
- `list_inventory`, `list_schedule_inventory`: read stock/defaults, including inactive items; run stock includes reserved and available quantities
- List tools for markets, runs, produce, schedules, and inventory accept `limit` (1–100, default 50) and `offset` (default 0), returning arrays. Advance offset by limit until a short/empty page. Runs filter by `marketId`, `status`, `from` (inclusive opening timestamp), and `to` (exclusive); active/upcoming work sorts before history. Catalog search supports `search`, `category`, and `farmId`; farms support `search` and `active`; markets support `search`; schedules support `marketId` and `active`
- `create_market` with name, address, and timezone
- `schedule_run` with `marketId`, offset-bearing ISO timestamps (`cutoffAt`, `startsAt`, `endsAt`, `deliveryStartAt`, `deliveryEndAt`), and `deliveryFeeCents`
- `save_inventory` with `runId`, `produceId`, `priceCents`, offered `quantity`, and `active`
- `create_produce` with catalog fields and an existing active `farmId`
- `cancel_run`: only empty scheduled runs; MCP cannot cancel runs containing orders

Use `active: false` with `save_inventory` or `save_schedule_inventory` to remove an item from sale for a run or future dates; `save_schedule` with `active: false` pauses generation. Historical records are retained. MCP provides no tools to place, edit, cancel or fulfill orders, or change their cash records. Driver approval/reassignment, invitation revocation, MCP token management and administrator grants are also not exposed as MCP tools. Those operations use the authenticated app or trusted CLI. Cancelling a booked run remains an app operation. Update tools require the complete farm/market/catalog/run fields plus `id`, rather than partial patches. MCP errors include a stable `code` and a readable `error`; successful mutations return the saved record or a success result.

Typical AI workflow: `list_farms` / `create_farm` → `create_produce` with `farmId` → `list_markets` / `create_market` → `save_schedule` → `save_schedule_inventory` → `run_scheduling_job`. Use `list_runs` and `list_inventory` to verify generated dates. `save_inventory` changes an already generated date; set `repeat: false` for a one-time change. Use `list_orders` and `get_order` to monitor customer orders; customer checkout and driver fulfillment remain authenticated app operations.

The UI and MCP call the same business operations and produce audit events. A market run represents one specific date. Persistent `market_schedules` store weekday (Sunday=0), local opening/closing times in minutes after midnight, cutoff lead time, delivery delay after opening, delivery duration/fee, active status, and an optional Thanksgiving exclusion. `schedule_inventory` stores default stock and prices for new dates.

The scheduling job prepares four upcoming orderable dates per active schedule. Customer, driver, administrator, and MCP run-list queries are read-only. The customer page refreshes every minute and shows market dates within the next 14 days whose cutoff is still ahead. PostgreSQL computes local dates in the market timezone, including daylight saving. Cancelled dates stay cancelled; the job fills the buffer with subsequent weeks instead. Disabling a schedule stops generation but does not cancel existing runs.

Use **Operations → Markets → Recurring weekly schedules**, or MCP tools `list_schedules`, `save_schedule`, and `save_schedule_inventory`, to manage recurrence. Changes affect newly created runs only. Inventory edits on a generated run default to saving the same prices/quantities for future dates; uncheck that option for a one-time change. Because four dates are prepared ahead, use per-run inventory edits to change dates that already exist. Existing runs, prices, reservations, and orders are never overwritten by the job.

## Scheduled job infrastructure

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

## Schema and workspace

```text
apps/web       React screens and typed API client
apps/api       Auth handler, tRPC, MCP, queries, transactional operations
packages/db    Schema, SQL migrations, seed, connection factory
scripts        Trusted administrator bootstrap and isolated E2E startup
tests/e2e      Browser and HTTP integration tests
```

The schema covers users, auth accounts/sessions/verifications/rate limits, customer profiles, driver profiles, extensible roles, invitations, markets, dated market runs, run inventory, orders, order-item snapshots, purchases, order history, MCP tokens, and operations audit events. Farms are reusable managed catalog entities; there is no farmer login/onboarding flow. Orders carry `driver_id`, `claimed_at`, and their own fulfillment status. `purchases.order_item_id` identifies the order line being bought. Order items snapshot farm ID, name and location as well as product name, sale unit and price.

Database constraints enforce foreign keys, unique reservations/items/request keys, valid run dates, nonnegative money, and inventory bounds. Exclusive run-row locks coordinate checkout, cancellation, inventory edits, shopping, closing and delivery transitions. Claims take a shared run lock and lock only the selected orders for mutation. Order-row locks protect per-order transitions; driver-profile share locks prevent a claim racing with suspension. Market dates retain their schedule/availability role; they do not own a driver or a shopping list. All money is integer USD cents; quantities are whole sale units such as bunches, baskets, or pounds. Fractional weights are not supported yet.

To change the schema, edit the files under `packages/db/src`, run `npm run db:generate`, review the SQL and metadata, and run `npm run db:migrate`. Drizzle maintains ORM update timestamps; direct SQL writers must maintain those fields themselves. The API applies pending migrations at startup before accepting requests. The manual command remains useful for database setup before seeding or running standalone CLI tools.

The committed migration history is preserved unchanged:

1. `0000_auth_and_basics.sql`: authentication, profiles, catalog, and market locations.
2. `0001_orders_and_fulfillment.sql`: schedules, dated runs, orders, purchases, and history.
3. `0002_shopping_packing.sql`: packing timestamps and checks.

**One follow-up migration, `0003_networks.sql`, contains all network changes**:
ownership and isolation, branding, support contacts, location defaults, and email
identity. The new networks table includes all configuration columns from the start.
Existing accounts, vendors, schedules, inventory, orders, and tokens move into Ojai;
legacy administrators retain global access and gain Ojai administrator membership.
No application data or merged migration files are replaced.

`npm run db:setup` applies the migration history and seeds Ojai for a new database.
For an existing installation, `npm run db:migrate` applies only the network upgrade;
the API also migrates on startup. Future changes should use subsequent migrations.
The destructive `npm run db:reset:local` command remains available only for
explicitly resetting disposable local data; it is not required for this upgrade.

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

Tests start their own web/API servers on ports 5180/3101 and use a separate PostgreSQL container on port 5433 with a temporary filesystem. Override `E2E_DATABASE_URL` only with an isolated database whose name ends in `_e2e`; the runner refuses other names. Tests recreate only this isolated test database’s application schema and migration ledger at startup, create uniquely named fixtures, and never truncate development data. Failure screenshots, traces, and an HTML report are ignored by Git.

The migration test installs the committed schema, creates representative existing data, then applies the network migration and verifies ownership, administrator roles, order snapshots, isolation, and concurrent retries without losing data. It uses a disposable database and requires `CREATEDB` on the isolated test PostgreSQL role (provided by the bundled Docker/CI setup).

The suite covers production verification/resend with a stubbed email provider, secure session cookies, production configuration validation, atomic address request limits, administrator driver reassignment, invitation-only signup and sessions, profile persistence, administrator UI, customer checkout, driver shopping and delivery (including shortages and retry), concurrent stock reservation, idempotency, cancellation, cutoff enforcement, authorization, immutable order snapshots, and authenticated MCP tools/token lifecycle. GitHub Actions runs these checks against PostgreSQL and Chromium.

## Deployment

Build with `npm ci && npm run build` and start the API with `NODE_ENV=production npm run start:api`. Serve `apps/web/dist` as static assets and route `/trpc` and `/api/auth` to the API on the same public origin. Same-origin hosting is recommended for session cookies.

For separate hosts, set `VITE_API_URL` and `VITE_AUTH_URL` at frontend build time and configure the exact `WEB_ORIGIN` and public `BETTER_AUTH_URL`. Cross-site cookie policy requires additional deployment-specific configuration; it is not enabled by default. Use the database provider’s TLS configuration, and do not disable certificate verification. Set `API_HOST=0.0.0.0` for containers. Scoped esbuild overrides keep migration/build dependencies patched.

The API includes structured logging with credential redaction, connection pooling, graceful shutdown, `/health` liveness, and `/ready` database readiness. On Vercel the pool is attached to the platform lifecycle so idle connections can drain before instance suspension. Use a hosted PostgreSQL pooler compatible with transactions and size the provider connection budget for multiple API instances (up to 10 connections each).

### Vercel test deployment

Deploy one Vercel project with the repository root as its Root Directory, Node 22, and the workspace lockfile. The root `vercel.json` defines independently built `api` (Fastify, `apps/api`) and `web` (Vite, `apps/web`) services. Remove old dashboard build/output overrides that applied to a single app; build settings now belong to each service. See [Vercel Services](https://vercel.com/docs/services).

The API runs pending Drizzle migrations at startup, before creating the server or accepting requests. Each instance takes a PostgreSQL transaction-scoped advisory lock before creating/reading Drizzle's migration ledger. Concurrent cold starts and manual CLI migrations wait for that same lock; after acquiring it, already-applied migrations are skipped. Migration failure closes the database pool and aborts startup. Warm requests do not rerun migrations. Builds remain database-independent.

The API service's `functions` configuration explicitly includes `packages/db/drizzle` (SQL files and the journal) in the runtime deployment. Keep these assets with the repository layout when running the compiled API outside Vercel too. The startup path is relative to the API module, so it works regardless of the working directory.

Set `DATABASE_URL` in Vercel for each environment you deploy, with runtime connectivity and schema-change permissions. Preview instances migrate their configured database too; give them a separate database. During a rolling deployment the previous application version can still serve traffic, so schema changes must remain compatible with it. Rolling back app code does not roll back database migrations.

Keep the API's `entrypoint: "src/index.mts"` and `outputDirectory: "."` settings. This makes Vercel bundle the source and trace workspace dependencies instead of promoting `dist/index.mjs` to the function root without its dependency layout; see [Vercel issue #17651](https://github.com/vercel/vercel/issues/17651). The web service still uses `dist` for its static output.

The top-level rewrites send `/api/:path*` (including Better Auth), `/trpc/:path*`, `/mcp`, `/health`, `/ready`, and the exact `/internal/jobs/market-runs` path to `api`. All remaining paths go to `web`. Request paths are preserved, matching the existing Fastify routes and browser clients; `/api` is not stripped. MCP still requires an administrator bearer token, and the cron endpoint still requires `CRON_SECRET`.

There are no service bindings: the Vite app runs in the browser and calls the public API on the same origin. It has no server function that calls the API internally. Vercel bindings resolve only in runtime functions, so they cannot replace browser URLs or the old build-time `API_ORIGIN` proxy. PostgreSQL is an external managed database, not a Vercel service; the local Docker Compose services are development/test databases only. The worker is replaced by the configured Vercel crons rather than deployed as another service.

Set environment variables in the relevant Vercel environment, then redeploy:

| Variable                       | Value                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Hosted **test** PostgreSQL database URL with the provider's verified TLS settings |
| `BETTER_AUTH_SECRET`           | Random secret, at least 32 characters                                             |
| `CRON_SECRET`                  | A different random secret, at least 32 characters                                 |
| `WEB_ORIGIN`                   | Exact shared public HTTPS origin, such as `https://market-test.example.com`       |
| `BETTER_AUTH_URL`              | The same shared public HTTPS origin                                               |
| `RESEND_API_KEY`, `EMAIL_FROM` | Working Resend credentials and verified sender                                    |
| `GOOGLE_MAPS_API_KEY`          | Optional key with Places API (New) and Address Validation enabled                 |

Remove the old `API_ORIGIN` setting and leave `VITE_API_URL` and `VITE_AUTH_URL` unset for this setup. Production startup rejects missing HTTPS origins, example secrets and incomplete Vercel auth/cron settings. Use a stable alias for testing; a different preview URL needs matching origin configuration. Do not share preview/staging databases or auth secrets with a real production service.

To test service routing locally, run `vercel dev` from the repository root (or `vercel dev -L` without cloud authentication). Start PostgreSQL first and supply the API's required environment variables. Set `WEB_ORIGIN` and `BETTER_AUTH_URL` to the local Vercel URL (typically `http://localhost:3000`), not Vite's underlying port. Do not run `npm run dev` simultaneously: Vercel starts both services itself. Cron is not scheduled locally; invoke the protected endpoint or `npm run jobs:run` manually.

API startup applies migrations automatically. After the first successful API request (for example, `/ready`), bootstrap the catalog and account from the workspace root with deployment variables exported in the shell:

```sh
npm run db:seed         # Optional: fictional Ojai catalog and schedules for testing
npm run jobs:run
npm run invite:create -- you@example.com customer
# Create and verify your account through the printed frontend invitation URL.
npm run admin:grant -- you@example.com
```

Shell-exported deployment variables take precedence over the local `.env`. Do not overwrite local development settings with production credentials or run database resets against a hosted database. API startup migrates automatically on all hosts. For database setup before standalone CLI tools or a manual migration retry, use `npm run db:migrate` with the target database credentials.

Before inviting testers, verify `/health` and `/ready` on the shared domain and these flows through the **shared URL**: invitation signup → delivered verification email → verified session → sign-out/sign-in; verification resend; password reset; profile save; checkout/cancellation; driver invitation signup and order claim/shopping/delivery; and Operations per-order driver reassignment. Confirm `/trpc/me` traffic reaches the API service on the shared origin and session cookies are Secure and HTTP-only. Verify Google autocomplete/validation with the deployed key if enabled. Run the scheduling job manually for preview tests: Vercel cron only schedules production deployments. For a dedicated test project deployed to its production environment, verify the daily cron in Vercel and Operations history.

Local checks validate code and isolated database behavior; hosted email delivery, Vercel routing/protection, provider TLS and managed cron execution still require this deployment smoke check. No hosted project or credentials are provisioned by the repository.

Before a larger launch, define delivery service areas, address validation, pricing/fee rules, notifications, and operational procedures for driver handoffs. Orders from the same date can already be claimed by different drivers. Routing optimization, automatic payment settlement, fractional weights, and receipt uploads remain future work. Driver order lists prioritize active work and support pagination; the Operations order list and MCP lists also support pagination. Market-date and catalog UI lists currently cap at 100 records and should gain pagination as those catalogs grow.

To rebuild the local database and reseed Ojai, stop the dev processes and run `npm run db:reset:local`, then restart `npm run dev`. This drops and recreates the `public` schema and removes the Drizzle migration ledger before applying the migration history; all local users, sessions, invitations, orders and catalog data are deleted. The reset refuses production mode, remote hosts and database names other than `market_delivered`. Create a new invitation/account afterward and grant your administrator role again if needed; existing accounts and invitation links are removed.

### Unfulfilled orders at market closing

The `close-expired-markets` job uses the stored market closing time. It cancels only orders that have not started shopping (`placed` or `claimed`), releases their reservations, and adds one system event. Repeated/overlapping jobs do not duplicate cancellation events. A closed market cannot accept new claims or shopping starts.

Orders already `shopping`, `ready`, `out_for_delivery`, or `delivery_failed` remain active. Drivers can finish recording purchases, finalize shopping, deliver and retry after closing. Market dates become completed after closing once no active fulfillment remains. Delivery windows may extend past market closing; the recurring schedule's delivery start must still fall within market hours. Unresolved shopping or failed deliveries remain visible for manual recovery rather than silently discarding purchased food.

## Networks and administrator roles

Each independently operated delivery business is a **network**. The network owns
its farms, catalog, market locations and schedules, inventory, orders, invitations,
MCP tokens, audit records, and job history. Customers and drivers share a platform
sign-in identity, with independent profiles, driver approvals, and memberships in
each network. Vendor relationships and inventory are never copied between networks.

Migration `0003_networks` creates **Ojai** (`ojai`) as the first network with its
local address defaults and assigns all existing operational data to it. Existing
`admin` users become `global_admin` users and Ojai `network_admin` members;
existing MCP tokens become Ojai-only tokens.

- **network_admin** manages operations, invitations, members, email settings, and
  MCP access within its network. It can grant `network_admin` to existing members
  or invite new network administrators. It cannot create networks or grant global
  access. A network administrator cannot demote the network's last administrator.
- **global_admin** has all network administrator permissions in every network,
  regardless of membership, plus platform network creation and global MCP access.
  Global administrators can add existing accounts to a network and override the
  last-administrator restriction. Global role grants use the trusted CLI.

Without an explicit selector, the app uses the first non-deleted network ordered
by creation time and ID (currently Ojai). There is no network dropdown. Global
administrators can still open a specific network from **Global administration**;
invitation links and MCP clients can also select a network using `?network=ojai`
or the API's `X-Network-Id` header (slug or UUID). Deleted networks cannot be
selected. A selector does not grant access. Opening another network reloads the
app to discard the previous network's cached data. Invitation and password-reset
links preserve the network selection. Existing users can sign in and accept an
invitation to another network using the same email.

**Operations → Configure** manages network settings and network administrators.
**Global administration** lists and creates independent networks and issues global
MCP tokens. After creating a network, open it and use **People** to invite its first
network administrator, or **Configure** to assign an existing account.

```sh
npm run db:migrate
npm run admin:grant -- owner@example.com global_admin
npm run admin:grant -- operator@example.com network_admin ojai
npm run invite:create -- operator@example.com network_admin ojai
```

The CLI defaults to the first non-deleted network for invitations and network-role
grants, and to `global_admin` for admin grants.

### Network isolation and database setup

Browser operations and MCP queries use a restricted PostgreSQL `market_network`
role with row-level security. Each standalone query or domain transaction sets its
network and actor with transaction-local settings, including when using transaction
poolers. Composite foreign keys also prevent records from referencing inventory,
profiles, markets, or vendors in another network. The restricted role cannot read
authentication secrets or network email credentials. Platform administration, auth,
and migrations use the trusted application connection. Background workers dispatch
separately per network, keeping each network's job history private.

On first install, the migration needs `CREATEROLE` to create the `NOLOGIN`,
`NOBYPASSRLS` role, and permission to grant that role to the application database
user. On hosted databases that disallow role creation, a database administrator
must provision `market_network` with those attributes and grant membership to the
application/migration user first. Do not give the restricted role ownership of the
application tables, superuser privileges, or `BYPASSRLS`.

### Network MCP management

The existing `/mcp` endpoint supports both token types:

- Tokens from **Operations → MCP access** always operate in their own network.
  A global administrator's network token still cannot access other networks or
  platform tools. Every request rechecks the owner's current permissions.
- Tokens from **Global administration → Global MCP access** require a current
  `global_admin` owner. They expose `list_networks` and `create_network`. Select a
  network with `/mcp?network=sonoma` (or `X-Network-Id`) to use operations tools in
  that network; the default is the first non-deleted network (currently Ojai). Global tokens never combine records from
  different networks in an operational query.

Both support `get_network`, `update_network`, `list_network_members`, and
`set_network_member`, alongside the existing market, vendor, inventory, schedule,
and order tools. `invite_user` also accepts `role: "network_admin"`. No invitation
or network tool can grant `global_admin`.

### Email overrides

**Operations → Configure**, or MCP `update_network`, can override `emailFrom` and
`emailKey` (Resend) independently. Missing overrides inherit `EMAIL_FROM` and
`RESEND_API_KEY`. Set a field to `null` to clear it; omitting it preserves its
current value. Keys are write-only, encrypted with AES-256-GCM using a key derived
from `BETTER_AUTH_SECRET` and bound to the network ID. Responses expose only
`hasEmailKey`, never the key or ciphertext. Re-enter stored network keys after
rotating `BETTER_AUTH_SECRET`. Sender addresses must be verified in the selected
Resend account.

Overrides apply to MCP invitation mail and verification/password-reset mail
initiated from that network. Platform email defaults are still required for
production authentication. Database URLs, auth secrets, trusted origins, and cron
secrets remain platform configuration. Custom domains and DNS are not part of this layer.

### Network branding

Use **Operations → Configure → Branding** to set primary, accent, background,
and text colors, choose a font preset, and upload a PNG/JPEG/WebP logo (up to 200 KB)
or supply an HTTPS image URL. The theme applies to the sign-in page, storefront,
and dashboards. Fonts use the existing DM Sans/DM Serif pair or installed Arial,
Georgia, or Trebuchet fonts; no custom CSS or font downloads are accepted.
**Header display** selects Logo, Text (the network name), or Logo + text.
Logo modes fall back to the network name when no logo is configured.
**Branding edits preview immediately in your browser** without changing the saved
app. **Save branding** publishes them; **Cancel changes** restores saved settings.
Leaving Configure discards unsaved edits. **Reset branding** previews the default
theme and logo; save to publish that reset.

MCP `get_network` returns branding. `update_network` accepts a `branding` object
with `primaryColor`, `accentColor`, `backgroundColor`, `textColor` (six-digit hex),
`font` (`default`, `modern`, `editorial`, `rounded`), and `logoUrl`, plus `headerDisplay` (`logo`, `text`, `logo-text`). Supplied fields
merge with saved branding. Set individual fields to `null` to restore their defaults,
or set `branding: null` to reset everything. Network administrators manage their
own branding; global administrators can manage any network. Public branding reads
contain no email settings or secrets.

### Configure through MCP

Every control under **Operations → Configure** is available through MCP:

| Configure control                    | MCP tool                                                              |
| ------------------------------------ | --------------------------------------------------------------------- |
| App name and email overrides         | `update_network` (`name`, `emailFrom`, write-only `emailKey`)         |
| Colors, font, logo, header display   | `update_network` (`branding`)                                         |
| Read saved configuration             | `get_network`                                                         |
| View administrators and members      | `list_network_members`                                                |
| Grant or remove administrator access | `set_network_member` (`email`, `role: "network_admin"` or `"member"`) |

For example, call `update_network` with:

```json
{
  "name": "Ojai Harvest",
  "emailFrom": "hello@example.com",
  "branding": {
    "primaryColor": "#3B245C",
    "accentColor": "#B68D4C",
    "backgroundColor": "#FBFAF6",
    "textColor": "#283E32",
    "font": "editorial",
    "logoUrl": "https://example.com/logo.png",
    "headerDisplay": "logo-text"
  }
}
```

To supply an uploaded logo, pass its PNG/JPEG/WebP base64 data URL as `logoUrl`.
To change the email key, supply `emailKey`; it is never returned by read tools.
Omit settings to keep them unchanged. Use `branding: null` to reset the theme,
and `emailKey: null` / `emailFrom: null` to restore the platform email defaults.

### Support, location defaults, and email identity

**Operations → Configure** includes support email, support phone, and an HTTPS
contact link. Configured contacts appear on account/profile and order pages and
in the shared footer. Blank contacts are hidden. These details are public; email
provider credentials and the reply-to override are not exposed by public reads.

Location defaults include city, US state, ZIP, and IANA timezone. They prefill
new delivery profiles and new markets; saved addresses and market timezones stay
unchanged. Address autocomplete can optionally use a five-digit search ZIP code and radius
in meters (1–50,000). The backend resolves the ZIP center through
[Zippopotam.us](https://docs.zippopotam.us/docs/getting-started/) (GeoNames data)
when settings are saved, and stores the ZIP with its latitude/longitude. Unchanged
ZIP codes reuse the saved center; lookup failures leave all settings unchanged.
No API key or new Google API needs to be configured. This biases suggestions, without
restricting delivery eligibility. Without a search center, autocomplete uses its
default US search. The network migration initializes Ojai defaults; newly created
operators have no location-specific defaults.

Invitations, verification emails, and password resets automatically use the app
name in their subject and sender display name. Sending still uses the configured,
verified sender email address and Resend account. **Email reply-to address** can
override where replies go; otherwise the support email is used when configured.

MCP `get_network` and `update_network` support `supportEmail`, `supportPhone`,
`contactUrl`, `emailReplyTo`, and `location`. Location fields are `city`, `region`,
`postalCode`, `timezone`, and `autocompleteBias: { postalCode, radiusMeters }`.
Coordinates are returned as saved data, but cannot be supplied as update inputs.
Set `autocompleteBias: null` to remove the search bias. Existing coordinate-only
centers remain active until replaced with a ZIP or explicitly cleared. Partial location updates merge with saved values. Set individual
fields to `null` to clear them, or `location: null` to clear all location defaults.
The supported address format remains US/USD; these settings do not introduce
international address or currency support.
