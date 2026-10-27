# Market Delivered

Market Delivered lets local operators run their own invite-only farmers market delivery service. Each network owns its vendors, inventory, orders, branding, and settings, with separate network and global administrator roles.

Customers order ahead of a market day. Drivers claim orders, shop and pack purchases, then deliver them. Customers pay cash at the prices set by operations; drivers record shortages and cash collected. Administrators manage operations through the dashboard or authenticated MCP tools.

Built with React, Vite, Fastify, tRPC, Better Auth, Drizzle, and PostgreSQL.

## Quick start

Requires Node 22.12+, npm, and Docker Desktop.

```sh
npm install
cp .env.example .env
# Set BETTER_AUTH_SECRET in .env to a random secret of at least 32 characters.
npm run db:up
npm run db:setup
npm run dev
```

Open <http://localhost:5173>. Setup creates an empty database with no networks, accounts, or catalog data.

Bootstrap a global administrator by setting `ADMIN_BOOTSTRAP_PASSWORD` in your shell (12–128 characters), then run:

```sh
npm run admin:bootstrap -- you@example.com
```

Sign in and use **Global administration** to create your first network, then open it to configure operations and invite members. See [local setup](docs/getting-started.md) for details.

## Documentation

| Guide                                      | Contents                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [Local setup](docs/getting-started.md)     | Installation, seed data, account bootstrap, and local reset       |
| [App workflows](docs/workflows.md)         | Customers, drivers, orders, inventory, and operations             |
| [App configuration](docs/configuration.md) | Branding, email identity, support contacts, and location defaults |
| [Networks and access](docs/networks.md)    | Ownership, administrator roles, and data isolation                |
| [MCP administration](docs/mcp.md)          | Connecting clients, tokens, tools, and configuration examples     |
| [Schedules and jobs](docs/jobs.md)         | Recurring markets, workers, cron, and market closing              |
| [Development](docs/development.md)         | Workspace layout, database migrations, and checks                 |
| [Deployment](docs/deployment.md)           | Hosting, environment variables, and launch checks                 |

Browse the [documentation index](docs/README.md) for suggested starting points.
