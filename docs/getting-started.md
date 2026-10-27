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

Open <http://localhost:5173> or <http://127.0.0.1:5173>. Development auth and API origin checks accept both loopback hostnames on the configured frontend port; production trusts only its configured origin. The API runs on port 3001; Vite proxies `/trpc` and `/api/auth`. The seed preserves existing records and adds 12 catalog items, source-vendor metadata, and the next Thursday and Sunday Ojai market runs with inventory. No sample accounts or production credentials are created.

Ojai seed schedules (Pacific time, verified October 21, 2026):

- [Ojai Community Farmers Market](https://www.ojaicommunityfarmersmarket.com/location): Thursdays, 3–7 p.m., 414 E. Ojai Avenue. The seed skips Thanksgiving, per the [operator FAQ](https://www.ojaicommunityfarmersmarket.com/faqs-1-1).
- [Ojai Certified Farmers Market](https://www.ojairotie.com/journal/farmers-market): Sundays, 9 a.m.–1 p.m., 300 E. Matilija Street.

Each seed run uses a sample cutoff 12 hours before opening, a delivery window during market opening hours, and a $5 delivery fee. These are our app defaults, not policies of the market operators. Dates follow `America/Los_Angeles` daylight saving rules. The seed initializes persistent schedules and inventory defaults. The scheduling job creates upcoming dates independently of page visits; re-seeding is unnecessary. Existing runs, orders, and inventory are preserved. The original Sonoma demo is replaced only if it has no orders. The example vendor names and produce/prices are fictional; they do not assert actual vendor participation or availability.

Bootstrap your own administrator account:

```sh
npm run invite:create -- you@example.com customer
# Open the printed invitation URL and create your account.
npm run admin:grant -- you@example.com
# Refresh the app to see Operations.
```

Customers and drivers need a valid, unexpired invitation matching their email to create an account. Invitations determine customer or approved-driver access; signup headers and profile forms cannot grant driver or administrator access. Administrators can suspend drivers; editing a suspended profile does not restore access.

Use **Operations → People** to create customer or approved-driver invitations. Share each link with its intended recipient. Invitations expire after 7 days, prefill a read-only signup email and work only with their specified email, can be revoked, and cannot be reused for another account. The trusted local CLI also supports `npm run invite:create -- driver@example.com driver`.

## Resetting local data

To rebuild the local database and reseed Ojai, stop the dev processes and run `npm run db:reset:local`, then restart `npm run dev`. This drops and recreates the `public` schema and removes the Drizzle migration ledger before applying the migration history; all local users, sessions, invitations, orders and catalog data are deleted. The reset refuses production mode, remote hosts and database names other than `market_delivered`. Create a new invitation/account afterward and grant your administrator role again if needed; existing accounts and invitation links are removed.

## Related guides

- [Development and database migrations](development.md)
- [Administrator roles](networks.md#administrator-roles)
- [Authentication and email](configuration.md#authentication-and-platform-email)
