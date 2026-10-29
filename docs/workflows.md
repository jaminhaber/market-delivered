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

The old shared operational frontend is removed. Its business capabilities remain
available through the public business API and network-scoped MCP: farms/catalog,
markets/schedules, inventory, invitations, driver approval and assignment, combined
shopping and allocation, packing, shortages, delivery state, and cash recording.

Approved drivers can claim orders, shop and pack them, then record delivery and
cash. Suspended drivers cannot claim work. Orders preserve the customer and item
snapshots from placement; later catalog/address edits do not change those records.

## Platform administration

The dashboard provides global-admin authentication and global MCP token management.
Network provisioning, settings, and membership belong to the admin API or platform
MCP. There is no network configuration screen in the dashboard and no network
selection or management UI in Silverstreak.
