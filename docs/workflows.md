# Workflows

## Silverstreak customers

- `/` introduces Silverstreak using the supplied photo; `/about` explains it.
- `/account?invite=...` accepts an emailed/CLI invitation. Signup remains invite-only.
- `/account` supports sign-in, password recovery, sign-out, and delivery details.
- `/order` lists open market dates and available inventory. The API calculates
  prices, validates the saved address and cutoff, and reserves stock atomically.
- `/orders` shows order items, estimates/final totals, fulfillment state, and eligible
  cancellations. Cash is collected on delivery; this stack does not charge a card.

Checkout supplies an idempotency request ID. Retrying the same submission cannot
create duplicate orders. Inventory and order snapshots remain network-scoped.
Address/cash/fulfillment invariants live in the shared backend, not the frontend.

## Business operators and drivers

Silverstreak administrators open **Admin** from their profile menu. Real routes
under `/admin` provide tabs for orders, driver approval, users and invitations,
farms, produce, markets and weekly hours, date-specific inventory, and job history.
MCP setup remains at `/mcp` and is linked from the same navigation. All pages use
Silverstreak's fixed API context and require business administrator access.

Silverstreak requests an explicit list of non-cancelled order statuses by default.
Both views use `orders.list`: `scope: "mine"` (the default) restricts results to the
signed-in customer; `scope: "network"` requires administrator access. The endpoint
accepts an optional `statuses` array;
omitting it or passing `[]` returns all statuses. The older `orders.mine` and
`admin.orders` endpoints remain compatible. Filtering happens in SQL before
pagination. The subdued
**Show cancelled orders** toggle below the list updates automatically and is
preserved when paging. Jobs similarly hide zero-impact runs, with an **Include
empty runs** toggle for the full history.

Invitations created in the Users page produce a shareable link; they do not send
an email. The MCP invitation tool can send invitation emails. The Users list
contains only members of this business. Network settings and global roles remain
platform-admin operations.

Driver shopping, packing, shortages, delivery, and cash recording remain available
through the business API and network-scoped MCP.

Approved drivers can claim orders, shop and pack them, then record delivery and
cash. Suspended drivers cannot claim work. Orders preserve the customer and item
snapshots from placement; later catalog/address edits do not change those records.

## Platform administration

The dashboard provides global-admin authentication and global MCP token management.
Network provisioning, settings, and membership belong to the admin API or platform
MCP. There is no network configuration screen in the dashboard and no network
selection or management UI in Silverstreak.
