# MCP

Market Delivered exposes one stateless Streamable HTTP endpoint at
`ADMIN_ORIGIN/mcp`. The shared backend handles `/mcp`; the administrator frontend
proxies it so discovery, sign-in, and consent share one public origin.

## Connect once as your account

Open `ADMIN_ORIGIN/oauth/connect`, or choose **MCP setup** in Silverstreak’s
business administration. Select ChatGPT or Claude and Desktop app or Terminal.
Add the connection address, sign in with your existing Market Delivered account,
and choose **Allow access as me**. Connecting does not require a global role.
There are no manually issued global or network tokens.

The assistant acts as the consenting user. Every tool invocation checks the
user’s current database permissions. A network administrator can operate only
on networks they administer; a global administrator can provision networks and
operate across the platform. Adding or removing a role changes the next request
without reconnecting. Consent explicitly includes future permissions.

Call `who_am_i` to inspect your identity and `list_networks` to discover available
network IDs. Every business tool requires an explicit `networkId`; there is no
implicit selection from cookies, headers, a slug, or token type. Unauthorized
networks fail before any business data is queried or changed. Existing network
query predicates and composite foreign keys continue to enforce data isolation.
The shared endpoint includes network management and business tools. Global-only
`create_network` is advertised only to current global administrators.

## OAuth boundary

There is one authorization server, `ADMIN_ORIGIN/oauth/auth`, one resource,
`ADMIN_ORIGIN/mcp`, and one permission scope, `mcp`. `offline_access` enables
refresh. Token scopes describe delegation to this API; they do not encode a
snapshot of the user’s business or global roles.

The administrator frontend proxies:

- `/mcp`
- `/oauth/auth/*`
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server/oauth/auth`

`/oauth/login`, `/oauth/authorize`, and `/oauth/connect` are browser pages. The
OAuth session uses a separate `md-oauth` cookie with `ADMIN_AUTH_SECRET`.
Dashboard sign-in remains restricted to global administrators with its `md-admin`
cookie. Business website sessions remain on each network’s own domain and cookie.
OAuth sign-up is disabled; accounts originate from invitations or trusted bootstrap.

Better Auth’s MCP provider owns client registration, S256 PKCE, resource binding,
token hashing, validation, refresh rotation, and revocation. CIMD uses its bounded,
DNS-pinned Node transport and validates metadata before application policy checks.
Connections use Bearer tokens; DPoP requests and DPoP-only clients are rejected.
Opaque access tokens expire after 15 minutes and rotating refresh tokens after
up to 90 days. Expired, revoked, wrong-resource, or missing-consent tokens fail.
A narrow ownership guard prevents a client from triggering refresh-token cleanup
for another client through the revocation endpoint.

**Connected assistants** at `/oauth/connect` lists the signed-in user’s grants.
Disconnect deletes that consent and access tokens and revokes that client’s
refresh tokens. Access is denied immediately, including for concurrently issued
tokens while consent is absent. Other users’ and other assistants’ grants are
unaffected. Refresh-token replay invalidates that user/client’s token family.

## Business operations

`invite_user` takes an explicit `networkId`, creates an invitation for that
network, and emails its registered frontend’s `/account` link. Success means the
provider accepted the email, not inbox delivery. Failed sends revoke the new
invitation. Catalog, scheduling, inventory, orders, and job tools all use the
selected network’s scoped database context and the user’s current permissions.
