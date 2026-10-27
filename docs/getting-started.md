# Local setup

[Documentation](README.md) · [Project README](../README.md)

Requires Node 22.12+, npm, and Docker Desktop.

```sh
npm install
cp .env.example .env
# Replace BETTER_AUTH_SECRET with a cryptographically random secret, at least 32 characters.
npm run db:up
npm run db:setup
npm run dev
```

Open <http://localhost:5173> or <http://127.0.0.1:5173>. Development auth and API origin checks accept both loopback hostnames on the configured frontend port; production trusts only its configured origin. The API runs on port 3001; Vite proxies `/trpc` and `/api/auth`. Setup creates no network, catalog, or account.

## Create the first operator

Set `ADMIN_BOOTSTRAP_PASSWORD` in your shell to a new password of 12–128 characters,
then run:

```sh
npm run admin:bootstrap -- you@example.com
```

This trusted command creates a verified global administrator account using Better
Auth password hashing. It does not create a network or change an existing account's
password. For an existing account, use `npm run admin:grant -- you@example.com`.
Unset the bootstrap password after use. Sign in, open **Global administration**,
create the first network, and open it to configure markets and invite members.
Normal requests require a network; the global administration dashboard and global
MCP tools remain available before one exists.

## Optional demo data

After manually creating a network, you can add fictional Ojai sample data in local
development with `npm run db:seed -- network-slug`. Seeding is opt-in, requires an
existing network, and is disabled in production. It adds three vendors, 12 catalog
items, recurring schedules, and upcoming market dates to that network only.

Ojai seed schedules (Pacific time, verified October 21, 2026):

- [Ojai Community Farmers Market](https://www.ojaicommunityfarmersmarket.com/location): Thursdays, 3–7 p.m., 414 E. Ojai Avenue. The seed skips Thanksgiving, per the [operator FAQ](https://www.ojaicommunityfarmersmarket.com/faqs-1-1).
- [Ojai Certified Farmers Market](https://www.ojairotie.com/journal/farmers-market): Sundays, 9 a.m.–1 p.m., 300 E. Matilija Street.

Each seed run uses a sample cutoff 12 hours before opening, a delivery window during market opening hours, and a $5 delivery fee. These are our app defaults, not policies of the market operators. Dates follow `America/Los_Angeles` daylight saving rules. The seed initializes persistent schedules and inventory defaults. The scheduling job creates upcoming dates independently of page visits; re-seeding is unnecessary. Existing runs, orders, and inventory are preserved. The example vendor names and produce/prices are fictional; they do not assert actual vendor participation or availability.

Customers and drivers need a valid, unexpired invitation matching their email to create an account. Invitations determine customer or approved-driver access; signup headers and profile forms cannot grant driver or administrator access. Administrators can suspend drivers; editing a suspended profile does not restore access.

Use **Operations → People** to create customer or approved-driver invitations. Share each link with its intended recipient. Invitations expire after 7 days, prefill a read-only signup email and work only with their specified email, can be revoked, and cannot be reused for another account. The trusted local CLI also supports `npm run invite:create -- driver@example.com driver`.

## Resetting local data

To rebuild an empty local database, stop the dev processes and run `npm run db:reset:local`, then restart `npm run dev`. This drops and recreates the `public` schema and removes the Drizzle migration ledger before applying the migration history; all local users, sessions, invitations, orders and catalog data are deleted. The reset refuses production mode, remote hosts and database names other than `market_delivered`. Bootstrap a global administrator and create networks again afterward; existing accounts and invitation links are removed.

## Related guides

- [Development and database migrations](development.md)
- [Administrator roles](networks.md#administrator-roles)
- [Authentication and email](configuration.md#authentication-and-platform-email)
