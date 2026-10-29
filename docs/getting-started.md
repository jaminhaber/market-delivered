# Local setup

Use Node 24 (`nvm use`), npm, and Docker Desktop. From the repository root:

```sh
npm install
npm run setup:local
npm run db:up
npm run dev
```

This starts the shared backend on 3001, dashboard on 5173,
Silverstreak on 4321, and a local job worker. Schema migrations run before
startup. Ctrl+C stops the processes. Use `npm run dev:apps` to omit the worker
and migration step, or `npm run dev:silverstreak` for just the website.

`setup:local` preserves existing secrets. If migrating an older `.env`, the new
admin configuration is `ADMIN_ORIGIN` plus an independent `ADMIN_AUTH_SECRET`.
`WEB_ORIGIN` and `BETTER_AUTH_URL` are no longer server configuration. Business
origins are registered per network.

## First administrator and business

Set `ADMIN_BOOTSTRAP_PASSWORD` in the shell to a new 12–128 character password:

```sh
npm run admin:bootstrap -- owner@example.com
```

Unset the variable afterward. Sign in at http://localhost:5173. For an existing
account, `npm run admin:grant -- owner@example.com global_admin` grants the role.
No public administrator signup exists.

```sh
npm run network:create -- silverstreak "Silverstreak" http://localhost:4321
```

Copy the returned ID into `apps/silverstreak/.env` as `SILVERSTREAK_NETWORK_ID`.
Restart development processes after changing configuration. The API origin is
`MARKET_API_ORIGIN=http://127.0.0.1:3001`. Neither variable is browser configuration.
An existing network needs `npm run network:configure -- slug http://localhost:4321`.

```sh
npm run invite:create -- customer@example.com customer silverstreak
npm run db:seed -- silverstreak
```

Seeding is optional, fictional, and disabled in production. Follow the invitation
to Silverstreak `/account`; create an account, save an address, and shop `/order`.
The homepage and about page render without API configuration. Shopping requires
a registered network, login, membership, open market dates, and stock.

## Resetting disposable development data

Stop dev processes and use `npm run db:reset:local` only when you want to erase
local development data. The command restricts its target to the local
`market_delivered` database. Re-bootstrap users and networks afterward.
`npm run db:down` stops PostgreSQL without deleting its volume.

Tests use a separate ephemeral database on port 5433 and never reset development
or production data. See [development](development.md).
