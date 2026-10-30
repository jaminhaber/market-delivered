# Architecture

## Applications and boundaries

Market Delivered runs one Fastify backend (`apps/api`).

The API composes `@market/core` with the reusable `@market/mcp` library. MCP tools
and transport live in `packages/mcp`; business operations, authorization, and
OAuth infrastructure live in core. Other server apps can import the same MCP
registration function without duplicating its tool catalog.

| Routes                                            | Purpose                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `/trpc`, `/api/auth/*`                            | Business API and browser authentication with explicit network context |
| `/admin/trpc`, `/admin/auth/*`                    | Global administration API and dashboard authentication                |
| `/mcp`, `/oauth/auth/*`, OAuth discovery          | Account-wide admin assistant connection                               |
| `/networks/:id/mcp`, `/networks/:id/oauth/auth/*` | Network-bound assistant access and OAuth                              |
| `/health`, `/ready`, `/internal/jobs/*`           | Health checks and protected scheduled jobs                            |

All routes share one PostgreSQL pool and deployment. Browser business and admin
sessions have separate secrets, cookie names, origin policies, and router
registries. OAuth identifies an existing user; application permissions determine
what that user can do. Neither a route nor a token type grants administrator roles.

`apps/admin` provides global statistics, OAuth onboarding, and account-wide
assistant connection management. `apps/silverstreak` is a bespoke Astro SSR site.
Its server calls the business API with its fixed configured network ID; its
restricted browser proxy exposes only storefront routes. A separate `/api/mcp`
proxy and resource-discovery route expose Silverstreak's network-bound assistant
connection. Login and consent pages remain on the admin site.

## Network context and permissions

Business API and browser-auth requests supply `X-Network-Id` (UUID or slug).
Silverstreak supplies its server-configured ID rather than accepting a selector
from its browser. Other businesses can host their own frontends against the same API.

The admin MCP is account-wide and requires explicit network IDs. App MCP
connections bind a grant to one network UUID and resource URL; tool arguments
cannot override it, even for a global administrator. Each invocation resolves the
network and reads current membership/global roles before constructing a scoped
database context. A role change affects existing assistant connections immediately.
Global administrators can use the admin connection for platform and business
tools. Network consent covers only current permissions within its fixed network.

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

OAuth login and consent are centralized on `ADMIN_ORIGIN`, using
`ADMIN_AUTH_SECRET`. The account-wide issuer at `/oauth/auth` uses `md-oauth`
cookies and permits existing accounts regardless of global role. A network
connection requires current administrator permission for that network.
The admin resource is `ADMIN_ORIGIN/mcp`; app resources use their registered
frontend origin and `/api/mcp`. Network issuers are hosted at
`ADMIN_ORIGIN/networks/<id>/oauth/auth`, with network-specific session cookies.
All connections use `mcp` and `offline_access` scopes.
Better Auth handles the protocol and validates opaque tokens; the application
checks consent and uses current permissions for each operation. See [MCP](mcp.md).
There are no manual API tokens. Network UUIDs persist in the provider's grant
reference IDs through code exchange and token refresh.

## Deployment

Three Vercel projects share one repository:

1. Root: the shared backend, MCP, OAuth, and protected jobs.
2. `apps/admin`: the dashboard and central assistant login/consent pages. Its proxy
   forwards admin API, OAuth, MCP, and discovery requests to the backend.
3. `apps/silverstreak`: the business website on its own domain.

A new business adds database records and a frontend. The shared backend resolves
its network-specific OAuth issuer dynamically; no separate OAuth deployment,
API deployment, or database is required. PostgreSQL and email remain configured
managed services.
