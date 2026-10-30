# Development

Use Node 24 (`.nvmrc`) and npm workspaces. `apps/api` is the single Fastify entrypoint; `packages/core` contains shared business logic and
separate public/admin router registries. `apps/admin` is a minimal React/Vite
application. `apps/silverstreak` uses Astro SSR and server-side typed API calls.

`packages/mcp` provides the shared server-side MCP tools and HTTP transport.
`apps/api` imports `registerMcp` from `@market/mcp` and supplies it to the core
server factory. See the [package guide](../packages/mcp/README.md) for reuse in
another app. Core business logic does not depend on the MCP package.

`packages/mcp-instructions` provides shared MCP provider/interface discovery and
structured OAuth setup instructions. Both frontends render this content
with their own components. See its [package guide](../packages/mcp-instructions/README.md)
when adding a provider, changing setup steps, or integrating another frontend.

## Commands

```sh
npm run setup:local
npm run db:up
npm run dev
npm run typecheck
npm run typecheck:e2e
npm run build
npm run test:db
npm run test:e2e
```

`dev` runs the whole stack, including the worker. `dev:apps` omits migrations and
jobs. Silverstreak runs in the foreground so the parent process can stop it.
Individual workspace scripts remain available for focused development.

## Migrations and isolation

Schema lives in `packages/db/src`; SQL/history lives in `packages/db/drizzle`.
Generate changes with `npm run db:generate`, inspect them, and apply with
`npm run db:migrate`. Commit generated SQL and migration metadata together.

The backend applies pending migrations before listening. An advisory lock
serializes concurrent migration attempts. Deploy schema changes compatible with
old instances during rolling releases. App rollback does not roll back data.

Use `networkDatabase`, `networkWhere`, and `networkValues` for business queries.
Do not reintroduce an implicit network or route management through the public
router. Authentication identities and authorized admin operations use platform
queries intentionally. No RLS or custom PostgreSQL role setup is required.

## Tests and dependencies

`business-api.spec.ts` covers orders, races, fulfillment, schedules, addresses,
MCP, migrations, and limited database roles. `platform.spec.ts` covers
API/auth/MCP boundaries and frontend workflows. E2E setup resets only the dedicated
`*_e2e` database and uses ports 5180 (backend), 5190 (admin frontend), and 4322 (Silverstreak).

The root `package.json` defines scoped dependency overrides and install-script
approvals. Review these alongside lockfile changes and run `npm audit` after
updating dependencies.
