# Development, database, and checks

[Documentation](README.md) · [Project README](../README.md)

## Schema and workspace

```text
apps/web       React screens and typed API client
apps/api       Auth handler, tRPC, MCP, queries, transactional operations
packages/db    Schema, SQL migrations, seed, connection factory
scripts        Trusted administrator bootstrap and isolated E2E startup
tests/e2e      Browser and HTTP integration tests
```

The schema covers users, auth accounts/sessions/verifications/rate limits, customer profiles, driver profiles, extensible roles, invitations, markets, dated market runs, run inventory, orders, order-item snapshots, purchases, order history, MCP tokens, and operations audit events. Farms are reusable managed catalog entities; there is no farmer login/onboarding flow. Orders carry `driver_id`, `claimed_at`, and their own fulfillment status. `purchases.order_item_id` identifies the order line being bought. Order items snapshot farm ID, name and location as well as product name, sale unit and price.

Database constraints enforce foreign keys, unique reservations/items/request keys, valid run dates, nonnegative money, and inventory bounds. Exclusive run-row locks coordinate checkout, cancellation, inventory edits, shopping, closing and delivery transitions. Claims take a shared run lock and lock only the selected orders for mutation. Order-row locks protect per-order transitions; driver-profile share locks prevent a claim racing with suspension. Market dates retain their schedule/availability role; they do not own a driver or a shopping list. All money is integer USD cents; quantities are whole sale units such as bunches, baskets, or pounds. Fractional weights are not supported yet.

To change the schema, edit the files under `packages/db/src`, run `npm run db:generate`, review the SQL and metadata, and run `npm run db:migrate`. Drizzle maintains ORM update timestamps; direct SQL writers must maintain those fields themselves. The API applies pending migrations at startup before accepting requests. The manual command remains useful for database setup before seeding or running standalone CLI tools.

The committed migration history is preserved unchanged:

1. `0000_auth_and_basics.sql`: authentication, profiles, catalog, and market locations.
2. `0001_orders_and_fulfillment.sql`: schedules, dated runs, orders, purchases, and history.
3. `0002_shopping_packing.sql`: packing timestamps and checks.

**Migration `0003_networks.sql` introduces the network layer**:
ownership and isolation, branding, support contacts, location defaults, and email
identity. The new networks table includes all configuration columns from the start.
It targets a fresh database and does not seed Ojai or assign implicit ownership.
The `0000`–`0002` migration files remain unchanged.

`npm run db:setup` applies migrations only. Recreate disposable staging databases
that applied an earlier `0003` version before deploying this change. Bootstrap a
global administrator, then create the first network manually; see [local setup](getting-started.md).
Future released changes should use subsequent migrations.

## Writing network queries

Business request handlers and per-network jobs receive an application-scoped database. The scope follows
transactions, but queries must explicitly call `networkWhere` for reads, updates,
join conditions, and upsert `setWhere` clauses, and `networkValues` for inserts:

```ts
await scoped.select().from(farms).where(networkWhere(scoped, farms));
await scoped.insert(farms).values(networkValues(scoped, input));
```

These helpers live in [network-scope.ts](../packages/db/src/network-scope.ts).
Preserve existing authorization and business conditions when adding the network
predicate. Global administration, authentication, and trusted CLI code use the
platform connection and explicit ownership where applicable. Scope helpers throw if called without a network; platform queries must use explicit
authorization and ownership conditions instead. Raw SQL does not gain an automatic network filter.

## Checks and E2E tests

```sh
npm run typecheck
npm run typecheck:e2e
npm run format:check
npm run build

npm run test:db
npx playwright install chromium
npm run test:e2e
```

Tests start their own web/API servers on ports 5180/3101 and use a separate PostgreSQL container on port 5433 with a temporary filesystem. Override `E2E_DATABASE_URL` only with an isolated database whose name ends in `_e2e`; the runner refuses other names. Tests recreate only this isolated test database’s application schema and migration ledger at startup, create uniquely named fixtures, and never truncate development data. Failure screenshots, traces, and an HTML report are ignored by Git.

Migration tests verify fresh setup is empty, ownership has no database default,
and retries are safe. A non-superuser regression test covers platform bootstrap,
global administration and MCP before the first network, cron behavior with no
networks, and scoped operations after manual creation. The isolated test runner
needs `CREATEDB` and `CREATEROLE` to create disposable databases and login fixtures;
the bundled Docker/CI setup provides them. Application deployments need neither.
The standard E2E server explicitly creates its Ojai test fixture after migration.

The suite covers production verification/resend with a stubbed email provider, secure session cookies, production configuration validation, atomic address request limits, administrator driver reassignment, invitation-only signup and sessions, profile persistence, administrator UI, customer checkout, driver shopping and delivery (including shortages and retry), concurrent stock reservation, idempotency, cancellation, cutoff enforcement, authorization, immutable order snapshots, and authenticated MCP tools/token lifecycle. GitHub Actions runs these checks against PostgreSQL and Chromium.

## Related guides

- [Local setup and reset](getting-started.md)
- [Network isolation and database permissions](networks.md#network-isolation-and-database-setup)
- [Jobs and worker commands](jobs.md)
- [Deployment](deployment.md)
