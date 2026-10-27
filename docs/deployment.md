# Deployment

[Documentation](README.md) · [Project README](../README.md)

Build with `npm ci && npm run build` and start the API with `NODE_ENV=production npm run start:api`. Serve `apps/web/dist` as static assets and route `/trpc` and `/api/auth` to the API on the same public origin. Same-origin hosting is recommended for session cookies.

For separate hosts, set `VITE_API_URL` and `VITE_AUTH_URL` at frontend build time and configure the exact `WEB_ORIGIN` and public `BETTER_AUTH_URL`. Cross-site cookie policy requires additional deployment-specific configuration; it is not enabled by default. Use the database provider’s TLS configuration, and do not disable certificate verification. Set `API_HOST=0.0.0.0` for containers. Scoped esbuild overrides keep migration/build dependencies patched.

The API includes structured logging with credential redaction, connection pooling, graceful shutdown, `/health` liveness, and `/ready` database readiness. On Vercel the pool is attached to the platform lifecycle so idle connections can drain before instance suspension. Use a hosted PostgreSQL pooler compatible with transactions and size the provider connection budget for multiple API instances (up to 10 connections each).

### Vercel test deployment

Deploy one Vercel project with the repository root as its Root Directory, Node 22, and the workspace lockfile. The root `vercel.json` defines independently built `api` (Fastify, `apps/api`) and `web` (Vite, `apps/web`) services. Remove old dashboard build/output overrides that applied to a single app; build settings now belong to each service. See [Vercel Services](https://vercel.com/docs/services).

The API runs pending Drizzle migrations at startup, before creating the server or accepting requests. Each instance takes a PostgreSQL transaction-scoped advisory lock before creating/reading Drizzle's migration ledger. Concurrent cold starts and manual CLI migrations wait for that same lock; after acquiring it, already-applied migrations are skipped. Migration failure closes the database pool and aborts startup. Warm requests do not rerun migrations. Builds remain database-independent.

The API service's `functions` configuration explicitly includes `packages/db/drizzle` (SQL files and the journal) in the runtime deployment. Keep these assets with the repository layout when running the compiled API outside Vercel too. The startup path is relative to the API module, so it works regardless of the working directory.

Set `DATABASE_URL` in Vercel for each environment you deploy, with runtime connectivity and schema-change permissions. Preview instances migrate their configured database too; give them a separate database. During a rolling deployment the previous application version can still serve traffic, so schema changes must remain compatible with it. Rolling back app code does not roll back database migrations.

Keep the API's `entrypoint: "src/index.mts"` and `outputDirectory: "."` settings. This makes Vercel bundle the source and trace workspace dependencies instead of promoting `dist/index.mjs` to the function root without its dependency layout; see [Vercel issue #17651](https://github.com/vercel/vercel/issues/17651). The web service still uses `dist` for its static output.

The top-level rewrites send `/api/:path*` (including Better Auth), `/trpc/:path*`, `/mcp`, `/health`, `/ready`, and the exact `/internal/jobs/market-runs` and `/internal/jobs/close-markets` paths to `api`. All remaining paths go to `web`. Request paths are preserved, matching the existing Fastify routes and browser clients; `/api` is not stripped. MCP still requires an administrator bearer token, and the cron endpoint still requires `CRON_SECRET`.

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

API startup applies migrations automatically. After the first successful API request (for example, `/ready`), bootstrap the global administrator from the workspace root with deployment variables exported in the shell:

```sh
# Set ADMIN_BOOTSTRAP_PASSWORD in this shell (12–128 characters).
npm run admin:bootstrap -- you@example.com
```

Unset the bootstrap password after use. Sign in and create your first network in
**Global administration** (or create a global MCP token there and use
`create_network`). Open the new operator to configure markets and invite members.
Setup and deployment never create an Ojai network or demo data. Protected cron
requests safely skip execution until a network exists. To prepare dates after
configuring schedules, run `npm run jobs:run`.

Shell-exported deployment variables take precedence over the local `.env`. Do not overwrite local development settings with production credentials or run database resets against a hosted database. API startup migrates automatically on all hosts. For database setup before standalone CLI tools or a manual migration retry, use `npm run db:migrate` with the target database credentials.

Before inviting testers, verify `/health` and `/ready` on the shared domain and these flows through the **shared URL**: invitation signup → delivered verification email → verified session → sign-out/sign-in; verification resend; password reset; profile save; checkout/cancellation; driver invitation signup and order claim/shopping/delivery; and Operations per-order driver reassignment. Confirm `/trpc/me` traffic reaches the API service on the shared origin and session cookies are Secure and HTTP-only. Verify Google autocomplete/validation with the deployed key if enabled. Run the scheduling job manually for preview tests: Vercel cron only schedules production deployments. For a dedicated test project deployed to its production environment, verify the daily cron in Vercel and Operations history.

Local checks validate code and isolated database behavior; hosted email delivery, Vercel routing/protection, provider TLS and managed cron execution still require this deployment smoke check. No hosted project or credentials are provisioned by the repository.

Before a larger launch, define delivery service areas, address validation, pricing/fee rules, notifications, and operational procedures for driver handoffs. Orders from the same date can already be claimed by different drivers. Routing optimization, automatic payment settlement, fractional weights, and receipt uploads remain future work. Driver order lists prioritize active work and support pagination; the Operations order list and MCP lists also support pagination. Market-date and catalog UI lists currently cap at 100 records and should gain pagination as those catalogs grow.

## Related guides

- [Authentication and email configuration](configuration.md#authentication-and-platform-email)
- [Scheduled jobs and cron authentication](jobs.md)
- [Database migration workflow](development.md#schema-and-workspace)
- [Network database permissions](networks.md#network-isolation-and-database-setup)
