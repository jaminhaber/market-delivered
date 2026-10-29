# Development

Use Node 24 (`.nvmrc`) and npm workspaces. `apps/api` is the single Fastify entrypoint; `packages/core` contains shared business logic and
separate public/admin router registries. `apps/admin` is a minimal React/Vite
application. `apps/silverstreak` uses Astro SSR and server-side typed API calls.

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
`npm run db:migrate`. Existing migration history is retained. The frontend-origin
migration is additive and does not erase existing users or business data; existing
networks must register their frontend explicitly.

The backend applies pending migrations before listening. An advisory lock
serializes concurrent migration attempts. Deploy schema changes compatible with
old instances during rolling releases. App rollback does not roll back data.

Use `networkDatabase`, `networkWhere`, and `networkValues` for business queries.
Do not reintroduce an implicit network or route management through the public
router. Authentication identities and authorized admin operations use platform
queries intentionally. No RLS or custom PostgreSQL role setup is required.

## Tests and dependencies

`business-api.spec.ts` retains backend tests for orders, races, fulfillment,
schedules, addresses, MCP, migrations, and limited database roles. Retired shared
frontend scenarios have been removed. `platform.spec.ts` covers the replacement
API/auth/MCP boundaries and current frontends. E2E setup resets only the dedicated
`*_e2e` database and uses ports 5180 (backend), 5190 (admin frontend), and 4322 (Silverstreak).

Scoped npm overrides patch Vercel's pinned dependencies without downgrading Astro.
Install-script approvals are pinned to reviewed esbuild/fsevents versions. Run
`npm audit` after dependency changes; do not use forced downgrades as a substitute
for compatible fixes.
