# Architecture

## Applications and boundaries

Market Delivered runs one Fastify backend (`apps/api`).

| Routes                                   | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `/trpc`, `/api/auth/*`                   | Business API and browser authentication with explicit network context |
| `/admin/trpc`, `/admin/auth/*`           | Global administration API and dashboard authentication                |
| `/mcp`, `/oauth/auth/*`, OAuth discovery | Account-wide assistant access and a single OAuth provider             |
| `/health`, `/ready`, `/internal/jobs/*`  | Health checks and protected scheduled jobs                            |

All routes share one PostgreSQL pool and deployment. Browser business and admin
sessions have separate secrets, cookie names, origin policies, and router
registries. OAuth identifies an existing user; application permissions determine
what that user can do. Neither a route nor a token type grants administrator roles.

`apps/admin` provides global statistics, OAuth onboarding, and account-wide
assistant connection management. `apps/silverstreak` is a bespoke Astro SSR site.
Its server calls the business API with its fixed configured network ID; its
restricted browser proxy exposes only storefront routes. Its MCP setup page links
to the central OAuth flow rather than running its own issuer or MCP proxy.

## Network context and permissions

Business API and browser-auth requests supply `X-Network-Id` (UUID or slug).
Silverstreak supplies its server-configured ID rather than accepting a selector
from its browser. Other businesses can host their own frontends against the same API.

MCP has one endpoint and credential model. Assistants call `list_networks`, then
supply an explicit `networkId` to every business tool. Each invocation resolves the
network and reads current membership/global roles before constructing a scoped
database context. A role change affects existing assistant connections immediately.
Global administrators can use the same connection for platform and business tools.
Consent covers acting as the user across their current and future permissions.

Application queries include network predicates, and composite foreign keys reject
cross-network references. Jobs explicitly iterate networks. User identities are
shared; memberships, customer profiles, driver approvals, catalogs, and orders are
network-owned. Network slugs are presentation identifiers, not token boundaries.

## Authentication and domains

Dashboard cookies use `md-admin` and `ADMIN_AUTH_SECRET`; business cookies use
`md-business-<network UUID>` and `BETTER_AUTH_SECRET`. Each network registers one
`frontendOrigin` for its browser Origin allowlist and account/invitation links.
Neither website relies on cross-site cookies. Public administrator signup is
disabled, and global roles require trusted provisioning.

OAuth is centralized on `ADMIN_ORIGIN` using `/oauth/auth`, `md-oauth` cookies,
and `ADMIN_AUTH_SECRET`. It permits existing accounts regardless of global role.
The sole MCP resource is `ADMIN_ORIGIN/mcp`, with `mcp` and `offline_access` scopes.
Better Auth handles the protocol and validates opaque tokens; the application
checks consent and uses current permissions for each operation. See [MCP](mcp.md).
There are no manual API tokens or per-network/per-platform OAuth instances.

## Deployment

Three Vercel projects share one repository:

1. Root: the shared backend, MCP, OAuth, and protected jobs.
2. `apps/admin`: the dashboard and central assistant login/consent pages. Its proxy
   forwards admin API, OAuth, MCP, and discovery requests to the backend.
3. `apps/silverstreak`: the business website on its own domain.

A new business adds database records and a frontend, not an API deployment,
OAuth issuer, or database. PostgreSQL and email remain configured managed services.
