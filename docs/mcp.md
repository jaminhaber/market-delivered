# MCP

There are two stateless Streamable HTTP endpoints with different credentials and
tool catalogs. Both accept authenticated POST requests and reject expired,
revoked, or currently unauthorized tokens.

| Endpoint                                      | Credential    | Tools                                                                          |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Shared backend `/admin/mcp` (local port 3001) | Global token  | Network provisioning, settings, membership, scoped token issuance              |
| Shared backend `/mcp` (local port 3001)       | Network token | Catalog, markets, schedules, inventory, invitations, orders, fulfillment, jobs |

Both endpoints run in one backend deployment. The dashboard also proxies
`/admin/mcp` through its own domain for its generated setup commands.

Create a global token in the dashboard after trusted bootstrap. Platform tools
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
(`/admin` on the Silverstreak website), then choose **MCP setup** (`/mcp`). This page creates, lists, and revokes the
current administrator's business tokens and provides private token-file setup
commands for Codex and Claude Code. It uses Silverstreak's fixed server context;
no network selector is accepted. Its displayed MCP server URL points to the
shared backend's `/mcp`, not the setup page itself. Ordinary customers cannot
view or use token management. OAuth authorization is not implemented yet.

Business `invite_user` sends an invitation to the network's registered frontend
`/account` route. Success means the provider accepted the email; it does not prove
inbox delivery. Failed sends revoke the newly created invitation. Catalog/stock
operations and job tools use the token's network context throughout.
