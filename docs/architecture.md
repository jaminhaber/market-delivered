# Architecture

## Applications and boundaries

Market Delivered runs one Fastify backend (`apps/api`) with separate route registries:

| Routes                                       | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `/trpc`, `/api/auth/*`, `/mcp`               | Network-scoped business API, authentication, and MCP        |
| `/admin/trpc`, `/admin/auth/*`, `/admin/mcp` | Global administration API, authentication, and platform MCP |
| `/health`, `/ready`, `/internal/jobs/*`      | Backend health and protected scheduled jobs                 |

Both namespaces use the same process, PostgreSQL pool, and deployment. Business
and administrator routes are encapsulated separately, with independent CORS
allowlists, authentication secrets, cookies, router registries, and MCP catalogs.
An admin URL does not bypass authorization. No network selector is needed for
global administration.

`apps/admin` calls only the admin API. It provides global MCP credentials and cross-network statistics. It has no storefront,
business operations, branding, or network configuration controls. `apps/silverstreak` is an Astro SSR
application with its own routes and presentation. Server-rendered shopping/account pages call the business API;
browser API calls use a restricted same-origin proxy.

## Network context

Business API and browser-auth requests supply `X-Network-Id` (UUID or slug).
Missing selectors fail; there is no default network. Public MCP and OAuth URLs
identify the network by its unique slug. Business MCP credentials carry an
immutable UUID binding. Changing a URL or header cannot change that binding.

Silverstreak reads its fixed ID from server configuration, never from a URL,
cookie, form, or browser header. Another business can implement its own frontend
on another host/domain and use the same APIs with its own fixed context.

The API scopes application queries and mutations with network predicates.
Composite foreign keys reject cross-network references. Jobs explicitly iterate
networks. Authentication identities are shared, while memberships, profiles,
driver approvals, business tokens, and business data are independent.

## Authentication and domains

Admin cookies use `md-admin` and `ADMIN_AUTH_SECRET`. Business cookies use
`md-business-<network UUID>` and `BETTER_AUTH_SECRET`. Neither cookie authenticates
the other surface. Administrator signup is disabled; bootstrap is a trusted CLI.
Management procedures and platform MCP check the current global role on every use.

Each network registers one `frontendOrigin`. The API validates browser Origin
against that network, uses that domain for authentication callbacks, and sends
invitation links to its `/account` page. Local loopback aliases are accepted only
in development. Production requires HTTPS. An unregistered frontend cannot log in
by supplying an arbitrary Origin.

Silverstreak forwards host-only cookies through its own origin, so its users do
not rely on cross-site cookies. Network selection does not grant membership.
Global tokens work only on the platform MCP endpoint; business tokens work only
on the public MCP endpoint.

Business OAuth grants bind one user and client to one network and the canonical
MCP URL on that network's registered website. The website proxies its network's
OAuth discovery and exchanges to the shared backend, reusing its host-only
sign-in cookie. Opaque OAuth tokens are hashed in the database and checked for
expiry, revocation, consent, session validity, and current administrator access.
The platform MCP shares this OAuth implementation with a separate `mcp:platform`
scope, `platform` grant reference, admin-origin audience, and admin sign-in. It
requires current global administrator access. Both MCP surfaces also accept
their respective manual API tokens.

## Deployment

Three Vercel projects share one repository:

1. Root: one backend service containing business and admin routes, both MCP catalogs, and protected jobs.
2. `apps/admin`: React dashboard on the administrator domain. Its routing proxy forwards only `/admin/*` API paths to the shared backend.
3. `apps/silverstreak`: Astro SSR frontend on Silverstreak's own domain.

Network creation adds database records, not another API instance or database.
Backend instances scale with traffic; each frontend deploys independently. Production PostgreSQL and
email delivery remain managed services configured through environment variables.
