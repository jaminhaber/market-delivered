# Networks, ownership, and access

[Documentation](README.md) · [Project README](../README.md)

Each independently operated delivery business is a **network**. The network owns
its farms, catalog, market locations and schedules, inventory, orders, invitations,
MCP tokens, audit records, and job history. Customers and drivers share a platform
sign-in identity, with independent profiles, driver approvals, and memberships in
each network. Vendor relationships and inventory are never copied between networks.

Migration `0003_networks` creates **Ojai** (`ojai`) as the first network with its
local address defaults and assigns all existing operational data to it. Existing
`admin` users become `global_admin` users and Ojai `network_admin` members;
existing MCP tokens become Ojai-only tokens.

## Administrator roles

- **network_admin** manages operations, invitations, members, email settings, and
  MCP access within its network. It can grant `network_admin` to existing members
  or invite new network administrators. It cannot create networks or grant global
  access. A network administrator cannot demote the network's last administrator.
- **global_admin** has all network administrator permissions in every network,
  regardless of membership, plus platform network creation and global MCP access.
  Global administrators can add existing accounts to a network and override the
  last-administrator restriction. Global role grants use the trusted CLI.

Without an explicit selector, the app uses the first non-deleted network ordered
by creation time and ID (currently Ojai). There is no network dropdown. Global
administrators can still open a specific network from **Global administration**;
invitation links and MCP clients can also select a network using `?network=ojai`
or the API's `X-Network-Id` header (slug or UUID). Deleted networks cannot be
selected. A selector does not grant access. Opening another network reloads the
app to discard the previous network's cached data. Invitation and password-reset
links preserve the network selection. Existing users can sign in and accept an
invitation to another network using the same email.

**Operations → Configure** manages network settings and network administrators.
**Global administration** lists and creates independent networks and issues global
MCP tokens. After creating a network, open it and use **People** to invite its first
network administrator, or **Configure** to assign an existing account.

```sh
npm run db:migrate
npm run admin:grant -- owner@example.com global_admin
npm run admin:grant -- operator@example.com network_admin ojai
npm run invite:create -- operator@example.com network_admin ojai
```

The CLI defaults to the first non-deleted network for invitations and network-role
grants, and to `global_admin` for admin grants.

## Network isolation and database setup

Browser operations and MCP queries use a restricted PostgreSQL `market_network`
role with row-level security. Each standalone query or domain transaction sets its
network and actor with transaction-local settings, including when using transaction
poolers. Composite foreign keys also prevent records from referencing inventory,
profiles, markets, or vendors in another network. The restricted role cannot read
authentication secrets or network email credentials. Platform administration, auth,
and migrations use the trusted application connection. Background workers dispatch
separately per network, keeping each network's job history private.

On first install, the migration needs `CREATEROLE` to create the `NOLOGIN`,
`NOBYPASSRLS` role, and permission to grant that role to the application database
user. On hosted databases that disallow role creation, a database administrator
must provision `market_network` with those attributes and grant membership to the
application/migration user first. Do not give the restricted role ownership of the
application tables, superuser privileges, or `BYPASSRLS`.

## Related guides

- [App configuration](configuration.md)
- [Network and global MCP tokens](mcp.md#network-and-global-access)
- [Database migrations](development.md#schema-and-workspace)
