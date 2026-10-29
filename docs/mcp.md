# MCP

The shared backend serves stateless Streamable HTTP endpoints with separate
business and global-administration credentials and tool catalogs. Both accept authenticated POST requests and reject expired,
revoked, or currently unauthorized tokens.

| Endpoint                                      | Credential            | Tools                                                                          |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| Shared backend `/admin/mcp` (local port 3001) | Global OAuth or token | Network provisioning, settings, membership, scoped token issuance              |
| Shared backend `/mcp` (local port 3001)       | Network token         | Catalog, markets, schedules, inventory, invitations, orders, fulfillment, jobs |

Both endpoints run in one backend deployment. The dashboard also proxies
`/admin/mcp` through its own domain for its generated setup commands.

Connect from **Global MCP access** in the dashboard after trusted bootstrap. Choose **ChatGPT** or **Claude**, then Desktop app or Terminal for OAuth setup. **API token / automation** instead offers ChatGPT (Codex) or Claude Code, token creation, private-file commands, and revocation. Platform tools
include `list_networks`, `create_network`, `get_network`, `update_network`,
`list_network_members`, `set_network_member`, and `create_network_token`. Operations
on an existing network take its explicit `networkId`. There is no default network
or query-string selection on the platform endpoint.

Business tokens are bound to one network. A supplied `X-Network-Id` must match
that binding. They cannot call platform tools, and global tokens cannot be used
on the business MCP endpoint. The token owner must retain appropriate access.

For CLI clients, send `Authorization: Bearer <token>` to the appropriate endpoint.
The dashboard provides file-based setup commands for Codex and Claude. Keep token
files private; tokens expire after 90 days and the plaintext is shown only once.
Revoking a token invalidates its next request.

Silverstreak administrators can open **Admin** from the profile dropdown
(`/admin` on the Silverstreak website), then choose **MCP setup** (`/mcp`).
This page provides OAuth setup, connected assistant disconnection, and optional
API token creation and revocation for automation. It uses Silverstreak's fixed server context; no network
selector is accepted. Ordinary customers cannot view or use these connections.

## Browser sign-in for global administrators

Use the admin dashboard origin followed by `/admin/mcp` as the connection URL.
Sign in with a global administrator account and approve **Allow global
administrator access**. The consent page explains that this grants access across
all networks. A network administrator account alone cannot authorize this flow.

The dashboard proxies these routes to the shared backend:

- `/admin/mcp`
- `/admin/auth/*`
- `/.well-known/oauth-protected-resource/admin/mcp`
- `/.well-known/oauth-authorization-server/admin/auth`

The issuer is `ADMIN_ORIGIN/admin/auth`, the sole resource audience is
`ADMIN_ORIGIN/admin/mcp`, and the permission scope is `mcp:platform` plus
`offline_access` for refresh. Grants use the `platform` reference, separate from
network UUIDs. Admin sign-in cookies and the admin authentication secret remain
separate from business authentication. Current global administrator permission
is checked when authorizing, issuing tokens, and using the MCP.

**Connected assistants** in Global MCP access lists the signed-in administrator's
platform connections and allows immediate disconnection. Existing global API
tokens continue to work on the same endpoint and can be revoked independently.

## Browser sign-in for business MCP

The primary connection URL is the business website's
`/networks/<network slug>/mcp`. Silverstreak's **MCP setup** page displays its
complete URL. Add it in an OAuth-capable assistant, sign in with the existing
business account, and approve the business administrator permissions. No token
file or custom network header is needed. `/mcp` on the shared backend also accepts
network-scoped manual tokens issued through the business API or platform MCP.

Network slugs are unique and identify public connection URLs, for example
`/networks/silverstreak/mcp`. Treat slugs as permanent identifiers: OAuth issuer
and resource URLs depend on them. Database relationships and grants use the
network UUID.

The setup page offers **ChatGPT**, **Claude**, or **API token / automation**.
ChatGPT and Claude offer **Desktop app** or **Terminal**, using OAuth; Desktop is
selected by default. Token setup instead asks for **ChatGPT (Codex)** or
**Claude Code** and shows token management alongside the relevant commands. Only the
selected combination's instructions appear; desktop setup includes a copyable
connection address, while terminal setup includes the relevant commands.

- **ChatGPT desktop:** Open **Settings → MCP servers → Add server**, name it
  Silverstreak, choose **Streamable HTTP**, and paste the connection address.
  Save, select **Restart**, then **Authenticate**.
- **Claude web or desktop:** Open **Customize → Connectors → Add → Add custom
  connector**, name it Silverstreak, paste the URL, and choose **Sign in now**.
  Organization owners may need to add the connector for their members.
- **Codex:** Run `codex mcp add silverstreak --url '<server URL>'`. Adding the
  server starts browser sign-in automatically. Use `codex mcp login silverstreak`
  to retry sign-in later.
- **Claude Code:** Run
  `claude mcp add --scope user --transport http silverstreak '<server URL>'`,
  then start Claude Code, run `/mcp`, select Silverstreak, and choose **Authenticate**.

Finish browser sign-in and approve Silverstreak access, then open a new chat and
ask: “Use Silverstreak to list upcoming markets.” Claude web and desktop connect
from Anthropic's servers and require a publicly reachable URL; local development
URLs work with the local CLI clients. See the official
[Claude connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[Claude Code commands](https://code.claude.com/docs/en/mcp), and
[ChatGPT desktop and Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

The website proxies its fixed network's MCP, OAuth, and discovery routes to the
shared backend. Other business frontends must expose the same routes on their
registered `frontendOrigin`:

- `/networks/<network slug>/mcp`
- `/networks/<network slug>/auth/*`
- `/.well-known/oauth-protected-resource/networks/<network slug>/mcp`
- `/.well-known/oauth-authorization-server/networks/<network slug>/auth`

The backend resolves network context from the URL. Its resource identifier and
issuer use the registered frontend origin, never a caller-supplied host. Grants
carry the network UUID as their reference and the business's canonical MCP URL
as their sole audience. Authorization codes and refresh tokens cannot authorize
a different network. Business OAuth tokens are rejected by `/mcp` on the shared
backend and by `/admin/mcp`. Platform OAuth tokens are rejected by business endpoints.

Better Auth's MCP and CIMD plugins implement discovery and authorization code
with S256 PKCE. Client registration supports CIMD and Dynamic Client Registration.
Connections use Bearer tokens; DPoP requests and DPoP-only clients are rejected.
MCP requests use stateless Streamable HTTP. OAuth access and refresh tokens are
opaque and hashed in PostgreSQL; access tokens last 15 minutes, refresh tokens
up to 90 days and rotate on use. Existing session validity and current
administrator permissions are required; signing out or losing access prevents
further MCP use. No broader business role is granted by connecting an assistant.

**Connected assistants** lists grants for the signed-in user and current network.
Disconnect removes the consent and revokes both access and refresh tokens
immediately, without affecting another network's connections.

Business `invite_user` sends an invitation to the network's registered frontend
`/account` route. Success means the provider accepted the email; it does not prove
inbox delivery. Failed sends revoke the newly created invitation. Catalog/stock
operations and job tools use the token's network context throughout.
