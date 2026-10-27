# MCP administration

[Documentation](README.md) · [Project README](../README.md)

The API exposes a stateless Streamable HTTP MCP endpoint at `/mcp`. **Operations → MCP access** displays the full endpoint for the current site (or the API host configured with `VITE_API_URL`). Local development proxies `/mcp` through the web server; the API is also available directly at <http://127.0.0.1:3001/mcp> with the default ports. Hosted clients need the deployed HTTPS endpoint rather than a localhost URL.

1. Sign in as an administrator.
2. Open **Operations → MCP access** and create a named token.
3. Save the token immediately; the raw value is shown once.
4. Configure your MCP client with the displayed endpoint, Streamable HTTP transport, and `Authorization: Bearer <token>`. The MCP access page includes a JSON configuration example; adapt it to your client's format. Use a client that supports custom headers or bearer tokens.
5. Connect and list markets to verify access. Opening the URL in a browser is not a connection test: this endpoint requires authenticated MCP POST requests and does not support the older SSE transport.

Tokens expire after 90 days, are stored only as SHA-256 hashes, and can be revoked. Each request also checks that the token owner still has administrator access. The integration uses explicitly configured bearer tokens; OAuth discovery and interactive OAuth login are not implemented.

Tools:

- `invite_user` with `email` and optional `role` (`customer` by default, `driver`, or `network_admin`): create a seven-day invitation and email the signup link. Requires configured Resend credentials and a verified sender, using [network overrides](configuration.md#email-overrides) or platform defaults, even locally. The recipient must sign up using the invited email address; driver invitations grant approved driver access after signup. Success reports `emailStatus: "accepted"` when the provider accepts the message, not confirmed inbox delivery. Failed sends revoke the new invitation and return an error. Each call creates a new invitation, so do not repeat successful calls. Network administrator invitations are supported; global administrator invitations are not.
- `list_markets`, `get_market`, `update_market`: inspect/edit market locations; timezone changes are blocked after runs exist
- `list_runs`, `get_run`, `update_run`: inspect run settings and order counts; update only unbooked scheduled runs before cutoff. Moving a recurring opening date requires cancellation and a one-off replacement
- `list_farms`, `get_farm`, `create_farm`, `update_farm`: manage reusable farms/vendors, contact details, shopping notes and archive status. Use `active: false` to archive without deleting history.
- `list_produce`, `get_produce`, `update_produce`, `catalog_options`: inspect/edit catalog items linked by `farmId`. Farm and sale unit cannot change after stock/defaults exist; create a new catalog item. Existing order snapshots and run prices stay unchanged.
- `list_orders`, `get_order`: read customer delivery snapshots, items, fulfillment history, run details and cash records. Lists accept `runId`, `marketId`, `customerId`, `driverId`, `status`, `from`/`to` (market opening time, inclusive/exclusive), and `limit`/`offset`; newest orders sort first. Both tools are read-only and require the same admin token
- `list_inventory`, `list_schedule_inventory`: read stock/defaults, including inactive items; run stock includes reserved and available quantities
- List tools for markets, runs, produce, schedules, and inventory accept `limit` (1–100, default 50) and `offset` (default 0), returning arrays. Advance offset by limit until a short/empty page. Runs filter by `marketId`, `status`, `from` (inclusive opening timestamp), and `to` (exclusive); active/upcoming work sorts before history. Catalog search supports `search`, `category`, and `farmId`; farms support `search` and `active`; markets support `search`; schedules support `marketId` and `active`
- `create_market` with name, address, and timezone
- `schedule_run` with `marketId`, offset-bearing ISO timestamps (`cutoffAt`, `startsAt`, `endsAt`, `deliveryStartAt`, `deliveryEndAt`), and `deliveryFeeCents`
- `save_inventory` with `runId`, `produceId`, `priceCents`, offered `quantity`, and `active`
- `create_produce` with catalog fields and an existing active `farmId`
- `cancel_run`: only empty scheduled runs; MCP cannot cancel runs containing orders

Use `active: false` with `save_inventory` or `save_schedule_inventory` to remove an item from sale for a run or future dates; `save_schedule` with `active: false` pauses generation. Historical records are retained. MCP provides no tools to place, edit, cancel or fulfill orders, or change their cash records. Driver approval/reassignment, invitation revocation, MCP token management and global administrator grants are also not exposed as MCP tools. Those operations use the authenticated app or trusted CLI. Network administrator membership is managed with `set_network_member`. Cancelling a booked run remains an app operation. Update tools require the complete farm/market/catalog/run fields plus `id`, rather than partial patches. MCP errors include a stable `code` and a readable `error`; successful mutations return the saved record or a success result.

Typical AI workflow: `list_farms` / `create_farm` → `create_produce` with `farmId` → `list_markets` / `create_market` → `save_schedule` → `save_schedule_inventory` → `run_scheduling_job`. Use `list_runs` and `list_inventory` to verify generated dates. `save_inventory` changes an already generated date; set `repeat: false` for a one-time change. Use `list_orders` and `get_order` to monitor customer orders; customer checkout and driver fulfillment remain authenticated app operations.

See [recurring schedules](jobs.md#recurring-schedules) for generation rules and inventory defaults.

## Network and global access

The existing `/mcp` endpoint supports both token types:

- Tokens from **Operations → MCP access** always operate in their own network.
  A global administrator's network token still cannot access other networks or
  platform tools. Every request rechecks the owner's current permissions.
- Tokens from **Global administration → Global MCP access** require a current
  `global_admin` owner. They expose `list_networks` and `create_network`. Select a
  network with `/mcp?network=sonoma` (or `X-Network-Id`) to use operations tools in
  that network; the default is the first non-deleted network (currently Ojai). Global tokens never combine records from
  different networks in an operational query.

Both support `get_network`, `update_network`, `list_network_members`, and
`set_network_member`, alongside the existing market, vendor, inventory, schedule,
and order tools. `invite_user` also accepts `role: "network_admin"`. No invitation
or network tool can grant `global_admin`.

## Configure through MCP

Every control under **Operations → Configure** is available through MCP:

| Configure control                    | MCP tool                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| App name and email overrides         | `update_network` (`name`, `emailFrom`, write-only `emailKey`)                   |
| Support contacts and reply-to        | `update_network` (`supportEmail`, `supportPhone`, `contactUrl`, `emailReplyTo`) |
| Location and autocomplete search ZIP | `update_network` (`location`)                                                   |
| Colors, font, logo, header display   | `update_network` (`branding`)                                                   |
| Read saved configuration             | `get_network`                                                                   |
| View administrators and members      | `list_network_members`                                                          |
| Grant or remove administrator access | `set_network_member` (`email`, `role: "network_admin"` or `"member"`)           |

For example, call `update_network` with:

```json
{
  "name": "Ojai Harvest",
  "emailFrom": "hello@example.com",
  "branding": {
    "primaryColor": "#3B245C",
    "accentColor": "#B68D4C",
    "backgroundColor": "#FBFAF6",
    "textColor": "#283E32",
    "font": "editorial",
    "logoUrl": "https://example.com/logo.png",
    "headerDisplay": "logo-text"
  }
}
```

To supply an uploaded logo, pass its PNG/JPEG/WebP base64 data URL as `logoUrl`.
To change the email key, supply `emailKey`; it is never returned by read tools.
Omit settings to keep them unchanged. Use `branding: null` to reset the theme,
and `emailKey: null` / `emailFrom: null` to restore the platform email defaults.

See [support, location defaults, and email identity](configuration.md#support-location-defaults-and-email-identity) for location patch fields and ZIP resolution behavior.

## Related guides

- [App configuration and email overrides](configuration.md)
- [Administrator roles and isolation](networks.md)
- [Scheduled jobs](jobs.md)
