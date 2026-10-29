# Deployment

Use three Vercel projects from the same Git repository and Node 24. There is one
backend deployment, two independent frontends, and one managed PostgreSQL database.

| Project root        | Configuration                                      | Domain example              |
| ------------------- | -------------------------------------------------- | --------------------------- |
| Repository root     | Root `vercel.json`: shared Fastify backend service | `api.marketdelivered.com`   |
| `apps/admin`        | Vite preset and server-side routing proxy          | `admin.marketdelivered.com` |
| `apps/silverstreak` | Astro preset and Vercel adapter                    | Silverstreak's own domain   |

For subdirectory projects, enable access to workspace files outside the Root
Directory and retain the repository lockfile. Build commands and output directories
are committed. The backend can alternatively be imported with `apps/api` as its
root using that directory's `vercel.json`; deploy only one backend project.

## Backend environment

Configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_AUTH_SECRET`,
`ADMIN_ORIGIN=https://admin.marketdelivered.com`, `RESEND_API_KEY`, `EMAIL_FROM`,
and `CRON_SECRET`. `GOOGLE_MAPS_API_KEY` is optional. Administrator and business
secrets must be different, random values of at least 32 characters. Preserve an
existing business secret because it also encrypts network email keys.
Use the database provider's verified TLS/pooling configuration; never disable
certificate verification. API instance pools are lifecycle-managed on Vercel.

The shared backend serves:

- `/trpc`, `/api/auth/*`, `/mcp`: business routes, with explicit network context.
- `/admin/trpc`, `/admin/auth/*`, `/admin/mcp`: global administration, with its own
  authentication, origin allowlist, cookies, and token requirements.
- `/health`, `/ready`, and protected `/internal/jobs/*` endpoints.

The admin routes are reachable on the API domain but require global authorization.
They do not appear in the business router or business MCP tool catalog. No second
backend deployment or admin API port is required.

## Frontend environment and domains

Set server-only `MARKET_API_ORIGIN=https://api.marketdelivered.com` on **both**
frontend projects. Silverstreak additionally needs `SILVERSTREAK_NETWORK_ID=<UUID>`.
No database credentials, signing secrets, or browser-prefixed secrets belong in
these frontend projects.

The admin frontend's Vercel routing proxy forwards `/admin/trpc`, `/admin/auth/*`,
and `/admin/mcp` to the configured backend. Vite provides the same forwarding in
local development. Silverstreak uses its existing restricted proxy and SSR calls.
Cookies remain host-only on each frontend; neither frontend relies on cross-site
browser cookies. The proxies only forward requests; all API, authentication, MCP,
and database logic runs in `apps/api`.

Attach each domain in Vercel Settings > Domains and apply the DNS records Vercel
provides. Register Silverstreak's exact HTTPS origin as its network's
`frontendOrigin` through admin MCP/API or trusted `network:configure` CLI. Set
`ADMIN_ORIGIN` to the admin frontend's exact origin. Authentication callbacks and
invitation links use the relevant frontend domain. Add other businesses by
registering their domains and network context; they share the same backend.

## First deployment

1. Push the repository and configure the shared backend project's production
   environment. Use a new production database or back up the existing database.
2. Deploy the backend. It applies pending migrations before listening; verify
   `/health` and `/ready`.
3. From a trusted terminal with production `DATABASE_URL` and
   `ADMIN_BOOTSTRAP_PASSWORD`, run `npm run admin:bootstrap -- owner@example.com`
   if no global administrator exists. Unset the bootstrap password afterward.
4. Create the production business with `npm run network:create -- silverstreak
"Silverstreak" https://your-business-domain.example`, or configure an existing
   business with `npm run network:configure -- slug https://your-business-domain.example`.
   Use the returned production UUID for Silverstreak; local demo data is not
   automatically transferred.
5. Configure and deploy both frontend projects. Sign into global administration,
   issue a global MCP token, and use `/admin/mcp` to issue network-scoped business
   tokens. Populate business catalogs and schedules through the business MCP.
6. Verify invitations, login/reset email links, order review/placement/cancellation,
   and statistics. Check foreign origins, missing selectors, and token swaps are
   rejected. Use a test network and staging email credentials first.

## Database and jobs

The backend applies migrations at startup using an advisory lock. SQL assets are
included in the backend bundle. Builds do not require a database. Give preview
and staging deployments their own databases, credentials, and registered origins.
Rolling releases require compatible migrations.

Only the backend project declares scheduled jobs. Supply `CRON_SECRET` and verify
production cron manually. The committed every-minute market-closing job requires
Vercel Pro/Enterprise, or an external scheduler if using a plan limited to daily
cron. PostgreSQL and email delivery remain external managed services.

This repository does not provision hosted projects or deploy automatically until
connected to your Vercel projects.
