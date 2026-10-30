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

The shared backend serves business API/browser auth at `/trpc` and `/api/auth/*`,
global dashboard API/auth at `/admin/trpc` and `/admin/auth/*`, and account-wide
assistant access at `/mcp` with its OAuth issuer at `/oauth/auth`. Network-bound
MCP and OAuth routes use `/networks/<id>/mcp` and `/networks/<id>/oauth/auth`.
The admin origin hosts every issuer and consent page. Silverstreak exposes its
MCP resource at its own `/api/mcp`, proxying to its fixed network's backend route.
No additional backend deployment is required.
Health endpoints and protected `/internal/jobs/*` run in the same service.

## Frontend environment and domains

Set server-only `MARKET_API_ORIGIN=https://api.marketdelivered.com` on **both**
frontend projects. Silverstreak additionally needs `SILVERSTREAK_NETWORK_ID=<UUID>`.
No database credentials, signing secrets, or browser-prefixed secrets belong in
these frontend projects.

The administrator frontend proxies `/admin/trpc`, `/admin/auth/*`, `/mcp`,
`/oauth/auth/*`, and OAuth discovery paths to the configured backend. Vite provides
the same forwarding locally. Its `/oauth/*` browser pages serve centralized
assistant login, consent, setup, and disconnection, including network-specific
flows under `/oauth/networks/<id>/`. The admin proxy also forwards network OAuth
and authorization discovery. Silverstreak proxies storefront calls and its own
network-bound `/api/mcp` and resource discovery. Cookies are host-only.
See [MCP](mcp.md) for the exact discovery URLs.

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
   connect an assistant through **Assistant connection** or `/oauth/connect`.
   Use that connection for account-wide management with explicit network IDs.
   Silverstreak administrators can instead use **MCP setup** on Silverstreak to
   connect only to that network through its public `/api/mcp` address.
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
