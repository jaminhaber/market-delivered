# Silverstreak

A bespoke Astro SSR application on the Market Delivered business API, deployed on
its own Vercel project/domain. It imports no admin UI and exposes no network picker,
network settings, or platform controls. Its homepage uses the supplied photo.

## Local development

From the repository root, use Node 24 and `npm run setup:local`, then configure:

```env
MARKET_API_ORIGIN=http://127.0.0.1:3001
SILVERSTREAK_NETWORK_ID=<the actual Silverstreak network UUID>
```

These values belong in this application's `.env` and are server-only. Register
`http://localhost:4321` as the network's `frontendOrigin`. Run the whole stack with
`npm run dev`, or just this application with `npm run dev:silverstreak`.

## Routes

- `/`: full-screen homepage, supplied landscape photo, Order now and About us.
- `/about`: the Silverstreak introduction.
- `/account`: invitation signup, sign-in/reset, delivery details, and sign-out.
- `/order`: server-rendered open markets, available items, and order placement.
- `/orders`: customer order history and eligible cancellation.
- `/admin` and `/admin/[section]`: business administration pages.
- `/mcp`: assistant setup instructions for Silverstreak.
- `/api/mcp`: Bearer-authenticated MCP proxy restricted to Silverstreak's network.
- `/.well-known/oauth-protected-resource/api/mcp`: MCP resource discovery.
- `/trpc/*`, `/api/auth/*`: restricted same-origin business proxy.

The homepage/about page work without an API. Account/order pages require a
configured network and API. The API computes prices, reserves stock, enforces
cutoffs/membership, and records immutable snapshots. Payment remains cash on
delivery. Operations and driver capabilities are available through the API/MCP,
not the retired shared frontend.

The proxy/client always supplies the configured network ID. Incoming headers,
forms, and query strings cannot select another business. Session cookies stay on
Silverstreak's domain; the API validates the actual browser origin against the
network record. Auth and customer responses are never cached.

## Vercel

Create a project with Root Directory `apps/silverstreak`, allow workspace files
outside the directory, use the Astro preset and Node 24, and attach Silverstreak's
domain. Set the two server variables above for that environment and register the
same HTTPS domain on the network. Use separate staging values for previews.
The API and administrator dashboard are different Vercel projects. OAuth login,
consent, and connection management use the admin site's network-specific flow at
`/oauth/networks/<network UUID>/connect`. The backend's `ADMIN_ORIGIN` must match
that admin site's public origin. Silverstreak requires no additional secrets.

MCP grants bind the network UUID and Silverstreak's registered `/api/mcp` resource.
They cannot access other networks or platform administration, including when the
user has global administrator permission. The admin MCP remains a separate
account-wide connection. See [MCP](../../docs/mcp.md) for the complete boundary.

Local Vite CORS handling is disabled so API endpoints can answer their own
preflight requests with the backend's CORS policy.

Validate with `npm run typecheck -w @market/silverstreak` and
`npm run build -w @market/silverstreak`. The root integration suite exercises the
application alongside the shared backend and the admin dashboard.
