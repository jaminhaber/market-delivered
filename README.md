# Market Delivered

Market Delivered is a shared delivery platform. Independently operated businesses
are **networks**: each owns its catalog, markets, inventory, orders, memberships,
invitations, integration tokens, email identity, and job history.

Silverstreak is a bespoke application on this API. Its server supplies one fixed
network ID; its pages have no network selector or platform configuration.

| Workspace           | Purpose                                                | Local address              |
| ------------------- | ------------------------------------------------------ | -------------------------- |
| `apps/api`          | Shared backend: business/admin APIs, MCP, and jobs     | http://localhost:3001      |
| `apps/admin`        | Global-admin sign-in and MCP token management          | http://localhost:5173      |
| `apps/silverstreak` | Astro SSR website, customer accounts, shopping, orders | http://localhost:4321      |
| `packages/core`     | Shared backend implementation                          | Used by the shared backend |
| `packages/db`       | PostgreSQL schema, migrations, network scoping, jobs   | Managed PostgreSQL         |

One backend serves business routes at `/trpc` and `/mcp`, with global
administration at `/admin/trpc`, `/admin/auth`, and `/admin/mcp`. The business
router and MCP catalog do not expose network-management tools. Admin and business authentication use separate signing secrets and cookie
names. Network management belongs to the administrator API; the minimal dashboard
provides global MCP credentials rather than network configuration screens.

## Run locally

Requires Node 24, npm, and Docker Desktop.

```sh
nvm use
npm install
npm run setup:local
npm run db:up
npm run dev
```

`setup:local` creates environment files and fills missing/example secrets without
replacing existing secrets. `dev` migrates the database, then runs the shared backend, the
admin dashboard, Silverstreak, and background jobs together. Ctrl+C stops them.

Bootstrap a global administrator by setting `ADMIN_BOOTSTRAP_PASSWORD` (12–128
characters) in your shell, then run:

```sh
npm run admin:bootstrap -- you@example.com
```

Unset the password after use. Sign in at http://localhost:5173. No public signup
or default network is created for administrators.

Provision Silverstreak explicitly:

```sh
npm run network:create -- silverstreak "Silverstreak" http://localhost:4321
```

Put the returned UUID in `SILVERSTREAK_NETWORK_ID` in
`apps/silverstreak/.env`, then restart the dev processes. For an existing network,
use `npm run network:configure -- its-slug http://localhost:4321` instead.

```sh
npm run invite:create -- customer@example.com customer silverstreak
# Optional fictional catalog and upcoming market dates:
npm run db:seed -- silverstreak
```

The invitation points at Silverstreak’s `/account` page. Customers can join, save
a delivery address, order from an open market, and view/cancel their orders.
Orders use cash on delivery and the existing fulfillment model. Silverstreak
administrators use the **Admin** profile-menu entry for business management tabs
and MCP setup. Driver fulfillment remains available through the business API or
network-scoped MCP.

## Checks

```sh
npm run typecheck
npm run typecheck:e2e
npm run build
npm run test:db
npm run test:e2e
```

Integration tests use only a database ending in `_e2e` and dedicated test ports.
They retain business invariants and cover the API boundary, independent auth,
MCP scopes, registered origins, and both frontends.

## Hosting

Deploy three Vercel projects from this monorepo: the repository root for the
shared backend, `apps/admin` for global administration, and `apps/silverstreak`
for the customer website. Both frontends point to the same backend and can use
independent domains. The admin frontend's server-side routing proxy and
Silverstreak's SSR proxy keep cookies on each frontend's own host.

See [deployment](docs/deployment.md), [architecture](docs/architecture.md), and
[local setup](docs/getting-started.md).
