# Networks, ownership, and access

[Documentation](README.md) · [Project README](../README.md)

Each independently operated delivery business is a **network**. The network owns
its farms, catalog, market locations and schedules, inventory, orders, invitations,
MCP tokens, audit records, and job history. Customers and drivers share a platform
sign-in identity, with independent profiles, driver approvals, and memberships in
each network. Vendor relationships and inventory are never copied between networks.

Setup creates no default network. A global administrator creates the first
operator through **Global administration** or the global MCP `create_network` tool.
Every business record requires explicit network ownership; the database provides
no fallback ID. Global tokens and platform audit events can have no network.

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
by creation time and ID (once one exists). There is no network dropdown. Global
administrators can still open a specific network from **Global administration**;
invitation links and MCP clients can also select a network using `?network=ojai`
or the API's `X-Network-Id` header (slug or UUID). Deleted networks cannot be
selected. When no network exists, ordinary requests fail; only global administration can
operate without one. A selector does not grant access. Opening another network reloads the
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

Browser operations, MCP queries, and background jobs scope reads and updates
with explicit `network_id` predicates in the application. Inserts supply the
selected network ID and reject a conflicting owner. Transactions and nested
savepoints retain the application scope. Global administration and authentication
use explicitly authorized platform queries.

Composite foreign keys prevent inventory, profiles, markets, orders, and vendors
from referencing another network. No custom PostgreSQL roles, `SET ROLE`, row-level
security policies, or `CREATEROLE` permission are required. The database login needs
normal schema migration and application read/write permissions.

The staging `0003_networks` migration uses application scoping and creates no network. Recreate the
disposable staging database before deploying this version; an already-applied copy
of that migration is not rerun. Keep the merged `0000`–`0002` history unchanged.

## Related guides

- [App configuration](configuration.md)
- [Network and global MCP tokens](mcp.md#network-and-global-access)
- [Database migrations](development.md#schema-and-workspace)
