# Workflows

## Silverstreak customers

- `/` introduces Silverstreak; `/about` explains the service.
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
omitting it or passing `[]` returns all statuses. Filtering happens in SQL before
pagination. The subdued
**Show cancelled orders** toggle below the list updates automatically and is
preserved when paging. Jobs similarly hide zero-impact runs, with an **Include
empty runs** toggle for the full history.

Invitations created in the Users page produce a shareable link; they do not send
an email. The MCP invitation tool can send invitation emails. The Users list
contains only members of this business. Network settings use the API or MCP;
global-role grants use the trusted CLI.

Approved drivers open **Driver** from the profile menu (`/driver`) and resume
their active market trip. A single workspace moves through **Shop → Pack →
Deliver** for both one order and multiple orders. Shopping is combined by vendor;
packing shows one customer bag at a time; delivery shows the address, directions,
phone, notes, and cash due. **View orders** contains the individual order details.
**Find orders** opens the claim pool. A trip picker appears only when there is
another active market date to choose. Driver phone and vehicle are editable in
the account page.

The driver API uses these trip-level procedures (amounts are integer cents):

- `driver.workspace({ runId? })` returns `{ trips, trip }`. Without a run ID it
  selects an in-progress trip before an unstarted trip, then the earliest market
  date. With no active work it returns `trip: null`. An explicit run ID can reopen
  an assigned completed trip. Another driver's trip is never returned.
- `trip` contains the market, run, all assigned orders, the complete vendor
  shopping list, cash records, `progress`, and `actions`. Progress includes the
  current `step` (`shop`, `pack`, `deliver`, or `complete`), recorded purchases,
  packed items, delivered orders, and outstanding cash. `actions.startShopping`
  and `actions.finishShopping` report current eligibility. These are hints;
  mutations recheck their rules inside transactions.
- `driver.packOrder({ orderId })` confirms the whole bag in one transaction.
  Repeating it leaves already packed items unchanged.
- `driver.completeDelivery({ orderId, expectedTotalCents, amountCents, note })`
  records cash and completes delivery together. The bag must be packed, the total
  must still match, and a cash shortfall needs a note. Repeating an identical
  successful completion does not duplicate events.
- `driver.reportDeliveryIssue({ orderId, note })` records a failed delivery in
  one transaction. Delivered orders with unpaid cash stay active until settled
  with `orders.recordCash`.

Existing per-order, batch shopping, allocation, and packing procedures remain
available. The trip shopping list includes every assigned order for the market
run, regardless of order-list pagination. MCP provides read-only order inspection alongside
catalog and scheduling tools. Silverstreak's `/api/mcp` connection is bound to
Silverstreak; the admin MCP requires explicit network IDs.

Approved drivers can claim orders, shop and pack them, then record delivery and
cash. Suspended drivers cannot claim work. Orders preserve the customer and item
snapshots from placement; later catalog/address edits do not change those records.

## Platform administration

The dashboard provides global administrator sign-in and statistics. Account-wide
assistant setup and connection management live at `/oauth/connect` and accept
existing user accounts.
Network provisioning uses the admin API or admin MCP and requires current global
permission. Settings and membership can also be managed by the network's own
administrators through API/MCP tools. Silverstreak's `/mcp` setup page offers its
network-only connection; consent and disconnection use
`ADMIN_ORIGIN/oauth/networks/<id>/connect`. There is no network configuration
screen in the dashboard or network picker in Silverstreak.

Driver UI renders can be regenerated with
`npx playwright test tests/e2e/driver-layout.spec.ts` after
starting `npm run test:db`. Phone and desktop screenshots for no orders, one
order, and three orders are saved under `artifacts/playwright/driver/` and attached
to the Playwright HTML report.
