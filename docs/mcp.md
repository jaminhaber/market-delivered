# MCP

The shared backend uses `@market/mcp` for stateless Streamable HTTP tools. Apps
expose separate public connections with different authorization boundaries:

| Connection   | Public MCP URL                                          | Access                                                                                           |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Admin        | `ADMIN_ORIGIN/mcp`                                      | Current account permissions across administered networks; global tools for global administrators |
| Silverstreak | Silverstreak's registered `frontendOrigin` + `/api/mcp` | Silverstreak only, including when the user is a global administrator                             |

Silverstreak's `/mcp` remains the browser setup page. Its `/api/mcp` proxy forwards
to backend `/networks/<network UUID>/mcp` using `SILVERSTREAK_NETWORK_ID` from
server configuration. Request headers, query parameters, and tool arguments
cannot change that binding. The proxy forwards Bearer credentials and protocol
headers, including CORS and authentication challenges in the response.

## Connect an assistant

In Silverstreak, choose **Admin → MCP setup**, select an assistant/interface, and
use the displayed Silverstreak connection address. Sign in to Market Delivered
and approve the consent screen identifying Silverstreak. The connection requires
current Silverstreak administrator or global administrator permission. Consent
is limited to Silverstreak; gaining other roles does not broaden this grant.

For an account-wide connection, use the admin dashboard's **Assistant connection**
or `ADMIN_ORIGIN/oauth/connect`. That flow retains the existing account-wide
consent and current-permissions behavior. No manual API tokens are issued.

Network-bound tools default to their fixed network. An explicit `networkId` is
accepted only when it matches that network. They cannot advertise or call
`create_network`, edit network slugs, or act on another network. Account-wide
tools still require explicit network IDs. Every invocation checks current roles.
Call `who_am_i` and `list_networks` to inspect the connection's effective access.

## OAuth and discovery

Login and consent pages are hosted on the admin origin. Each network has a
separate issuer path and session cookie; network grants persist the network UUID
in the provider's consent/code/token `referenceId`, which survives refresh.
Access validation checks that reference, the resource audience, and matching
consent. Binding to the UUID also prevents cross-network token use if two networks
are accidentally configured with the same frontend origin.

|                        | Admin                                                            | Network connection                                                             |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Issuer                 | `ADMIN_ORIGIN/oauth/auth`                                        | `ADMIN_ORIGIN/networks/<id>/oauth/auth`                                        |
| Authorization metadata | `ADMIN_ORIGIN/.well-known/oauth-authorization-server/oauth/auth` | `ADMIN_ORIGIN/.well-known/oauth-authorization-server/networks/<id>/oauth/auth` |
| Resource metadata      | `ADMIN_ORIGIN/.well-known/oauth-protected-resource/mcp`          | `<frontendOrigin>/.well-known/oauth-protected-resource/api/mcp`                |
| Browser pages          | `ADMIN_ORIGIN/oauth/{login,authorize,connect}`                   | `ADMIN_ORIGIN/oauth/networks/<id>/{login,authorize,connect}`                   |
| Session cookie prefix  | `md-oauth`                                                       | `md-oauth-<id>`                                                                |

The admin proxy forwards its existing admin/MCP/OAuth routes plus the network
issuer and authorization-metadata routes. It does not expose network MCP routes.
Silverstreak proxies its resource metadata and MCP endpoint; it does not proxy
OAuth cookies or admin APIs. The backend resolves each network's registered
frontend origin from the database. No new frontend secret is required.

Better Auth owns S256 PKCE, client registration, token hashing, opaque-token
validation, refresh rotation, and revocation. CIMD uses the bounded, DNS-pinned
Node transport. Connections use `mcp` and optional `offline_access` scopes with
Bearer tokens; DPoP requests and DPoP-only clients are rejected. Codes and refresh
tokens cannot be exchanged through another connection's issuer. Access tokens
expire after 15 minutes; refresh tokens have a 90-day lifetime on issuance.

Each connection page lists grants for its resource and network reference.
Disconnect deletes that consent and access tokens and revokes matching refresh
tokens. Missing consent blocks MCP access immediately. The previously identified
pending-code disconnect/reconnect edge case remains outside this change.

## Business operations

The library uses the selected network's scoped database context and current
permissions for catalog, inventory, scheduling, orders, invitations, and jobs.
`invite_user` emails the registered frontend's `/account` link; success means the
email provider accepted the message. Failed sends revoke the invitation.

### Image assets

Image tools use the same current network admin permissions as catalog tools.
Account-wide connections require `networkId`; network-bound connections default
to their network and reject other IDs.

1. Call `create_image_upload`. It returns `cloudflareImageId`, `uploadUrl`,
   `expiresAt`, and a dashboard `uploadPageUrl`. No database asset is created.
2. POST the file directly to `uploadUrl` as multipart/form-data with a `file`
   field. Keep the returned image ID.
3. Call `register_asset` with `cloudflareImageId`, `altText`, and
   `metadata: {"produce_id":"<existing-produce-uuid>"}`. The backend verifies
   Cloudflare completion and upload ownership, then inserts the asset.

Use `list_assets` with `produceId` to discover the current image. To replace it,
include that asset ID as `replaceAssetId` in registration. The original image is
retained without its produce association. Registration retries return the existing
asset without reattaching it. `update_asset` edits alt text; `delete_asset`
permanently deletes the Cloudflare image and asset row, removing it from produce
if attached. Produce list/detail tools also return image variant URLs.

Clients must have HTTP/file access to send the bytes; chat attachments are not
automatically exposed to MCP. Otherwise open `uploadPageUrl`, sign in as a
business administrator, and use the produce image editor. This starts a separate
dashboard upload. See [configuration](configuration.md#catalog-images) for
Cloudflare credentials and required variants.
