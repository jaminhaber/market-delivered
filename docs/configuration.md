# Configuration

## Environment

The root `.env.example` is the reference. The backend needs `DATABASE_URL` and the
stable `BETTER_AUTH_SECRET` (32+ characters). The latter signs business sessions
and encrypts per-network email credentials; rotating it requires a deliberate
credential migration.

The same backend also requires a distinct `ADMIN_AUTH_SECRET` (32+ characters)
and `ADMIN_ORIGIN`. The backend port defaults to 3001; the dashboard defaults
to 5173. `API_HOST=0.0.0.0` is appropriate for containers. Node 24 is the supported
runtime. Global auth has no dependency on a network record.

`RESEND_API_KEY` and `EMAIL_FROM` are required for production email. Development
without a provider prints account links to local API logs. `CRON_SECRET` protects
scheduled endpoints. `GOOGLE_MAPS_API_KEY` enables address lookup; manual address
entry and the rest of the API do not require it.

## Registered business frontend

A network's `frontendOrigin` is an HTTP loopback origin in development or an HTTPS
origin in production, with no path, credentials, query, or fragment. Configure it
through admin `networks.create`/`networks.update`, platform MCP, or the trusted
`network:create`/`network:configure` CLI. Missing configuration fails explicitly.
There is no shared global business URL or inferred/default network.

Each business supplies its own frontend and fixed API context. Silverstreak stores
`MARKET_API_ORIGIN` and `SILVERSTREAK_NETWORK_ID` in its server environment. Its
cookie proxy preserves the real browser Origin and overwrites incoming selectors.
Use separate staging values for previews.

## Email, support, and location

Admin `networks.update` and MCP `update_network` accept explicit network IDs.
Settings include business name, support contacts, US location/timezone defaults,
Places search bias, and email sender/reply-to/key overrides. Keys are write-only,
encrypted at rest, and never returned. Senders must be verified with the email
provider. Invitation links use the registered frontend's `/account` route and
never include a network selector.

Presentation belongs to each bespoke frontend. Silverstreak does not load theme,
logo, color, or network-branding settings from the API.

## Administrator frontend

`apps/admin` calls `/admin/trpc` and `/admin/auth` through its own origin. Locally,
Vite forwards those paths and `/admin/mcp` to `API_PORT` (default 3001). On Vercel,
set server-only `MARKET_API_ORIGIN=https://api.marketdelivered.com` on the admin
frontend project. Its routing proxy rewrites those paths to the same backend,
preserving cookies and the browser Origin. No database credentials or signing
secrets belong in the dashboard deployment. Configure the backend's `ADMIN_ORIGIN`
to the dashboard's exact HTTPS domain. Administrator MCP is also directly
available at the backend's `/admin/mcp` path.
