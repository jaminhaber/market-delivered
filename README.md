# Market Delivered

Market Delivered is a shared delivery platform. Independently operated businesses
are **networks**: each owns its catalog, markets, inventory, orders, memberships,
invitations, email identity, and job history.

Silverstreak is a bespoke application on this API. Its server supplies one fixed
network ID; its pages have no network selector or platform configuration.

| Workspace           | Purpose                                                | Local address              |
| ------------------- | ------------------------------------------------------ | -------------------------- |
| `apps/api`          | Shared backend: business/admin APIs, MCP, and jobs     | http://localhost:3001      |
| `apps/admin`        | Dashboard and account-wide assistant connections       | http://localhost:5173      |
| `apps/silverstreak` | Astro SSR website, customer accounts, shopping, orders | http://localhost:4321      |
| `packages/core`     | Shared backend implementation                          | Used by the shared backend |
| `packages/mcp`      | Reusable server-side MCP tools and transport           | Imported by backend apps   |
| `packages/db`       | PostgreSQL schema, migrations, network scoping, jobs   | Managed PostgreSQL         |

One backend serves business routes at `/trpc`, global administration at
`/admin/trpc`, and an account-wide admin assistant endpoint at `/mcp`. Silverstreak
exposes a separate, network-bound `/api/mcp` proxy. OAuth login and consent run on
the admin origin, with separate issuer paths for network grants. See [MCP](docs/mcp.md).
Admin connection tokens identify the user for platform and business tools, which
check current roles on every operation and require explicit network IDs. A
Silverstreak connection defaults to its fixed network and rejects other IDs.
Business website and administrator dashboard sessions remain separate.

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
and MCP setup. Driver fulfillment remains available through the business API.
MCP supports order inspection, catalog management, and scheduling.

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
MCP identity and live permissions, registered origins, and both frontends.

## Hosting

Deploy three Vercel projects from this monorepo: the repository root for the
shared backend, `apps/admin` for global administration, and `apps/silverstreak`
for the customer website. Both frontends point to the same backend and can use
independent domains. The admin frontend's server-side routing proxy and
Silverstreak's SSR proxy keep cookies on each frontend's own host.

See [deployment](docs/deployment.md), [architecture](docs/architecture.md), and
[local setup](docs/getting-started.md).
