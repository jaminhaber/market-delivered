# Customer, driver, and operations workflows

[Documentation](README.md) · [Project README](../README.md)

### Customers

Accept an invitation, sign in, and save a delivery profile with a name, phone number, address, and instructions. Choose a market day and quantities from that run’s inventory. Addresses use required street, city, state, ZIP and country fields, with an optional apartment/unit. **Street address** provides debounced Google Places autocomplete, biased toward the configured [location defaults](configuration.md#support-location-defaults-and-email-identity) and restricted to US results. Choose a suggestion with the mouse or arrow keys and Enter to fill street, city, state and ZIP; apartment/unit is preserved. Suggestions and place details use a shared session token through authenticated backend endpoints; the key stays on the server. Enable **Places API (New)** and add it to the key’s API restrictions alongside Address Validation. Manual entry remains available if suggestions fail. PostgreSQL-backed per-user limits allow 60 autocomplete requests, 10 detail requests, and 10 validation requests per minute, independently across API instances. Provider errors also count toward these limits. Set provider-side quotas and billing alerts as a separate overall spend limit.

After saving, **Look up saved address** calls Google Address Validation from the server using `GOOGLE_MAPS_API_KEY`. Enable **Address Validation API** on that key’s Google Cloud project and configure billing and appropriate server key restrictions. The lookup sends the saved address (including unit) but excludes delivery instructions. Incomplete addresses are rejected by lookup; suggested corrections are displayed for the customer to review, enter and save before retrying. Manual delivery using the entered address remains available if lookup fails.

Google results are displayed for the current lookup with attribution. Only the Google place ID, provider and lookup time are persisted; Google-returned formatted addresses and coordinates are not stored. Customer-entered structured addresses and place IDs are snapshotted on orders. Editing the address clears its saved place ID. Legacy Census coordinates remain on existing records until edited or replaced.

Checkout reserves inventory transactionally and stores immutable price and delivery-detail snapshots. Each checkout request has an idempotency key. Customers can view only their own orders and cancel before the cutoff, releasing reservations.

Customers pay cash at the unit prices saved when the order is placed. Shortages reduce the total by the unfulfilled quantity; driver purchase costs do not change customer pricing. The assigned driver can manually record the cumulative cash collected and a note, including corrections or partial collection. Customers can see their collected and outstanding amounts.

### Drivers

Accept a driver invitation and save your name, phone and vehicle before claiming individual orders. Customers cannot self-enroll as drivers. Administrators can suspend or restore access. Production accounts must verify their email before signing in.

The **Driver** dashboard has **Available orders** and **My orders**, with a market filter. The server groups orders by market and date, paginates five market dates at a time, and includes accurate counts plus the first 25 orders per date. **More orders** pages within a date without hiding other markets behind a large order list. Changing an order page clears its selections. On an available date, select individual orders or all shown orders and use **Claim selected** to send one server-side batch command. Each order remains individually assigned; different drivers can fulfill different orders from the same market date, and one driver can claim more than one order. The pool shows destination city/ZIP, unit count, order estimate and delivery fee. Customer names, street addresses, phone numbers and instructions remain restricted to the assigned driver and administrators. Drivers can claim and fulfill their own customer orders, which are labeled “Your order” in the driver dashboard and shopping views.

A claimed order can be released before shopping begins. Start shopping while the market is open; this does not wait for the market-wide order cutoff. Each order retains its own purchases and final total.

From **My orders**, use **Combined shopping list** on a market date to see every order assigned to you for that date, across all order pages. The list groups products by vendor, shows requested/bought/unrecorded/short quantities, vendor contact details, and shopping notes. Delivered orders are excluded from shopping totals. **Start shopping for all claimed orders** begins all your pending orders for that date.

Enter the total quantity and purchase cost for each product across orders still shopping. The form suggests shortage allocations in order-placement order; expand **Review allocations** to adjust each customer's quantity before saving. These are cumulative totals, including existing records, rather than an additional purchase. Each allocation stays within the ordered quantity. Costs are divided proportionally in exact integer cents, with rounding pennies assigned in placement order. Zero quantity requires zero cost. Purchases already finalized on other orders remain unchanged. Stale item membership or purchase versions reject the whole save; use **Refresh shopping list** and review before retrying.

**Finish shopping** finalizes every one of your shopping orders for that date together. Every item must have a purchase record, including zero for unavailable items; a missing record rolls back all finalization changes. Entirely unavailable orders have no delivery or payment due. Finalization can complete after market closing.

The **Packing checklist** then shows purchased quantities, vendor names, shortages, and delivery addresses by customer order. Check an item once its full purchased quantity is in the customer's bag. Checks are saved on the order item and survive refreshes and driver reassignment. Only the assigned, approved driver can update packing on ready or active-delivery orders; unavailable items cannot be marked packed. You can also continue shopping an individual order from **Open order**.

Customer totals use purchased quantities multiplied by the sale prices saved at checkout. Purchase costs do not change customer prices. Partially fulfilled orders retain their delivery fee; entirely unavailable orders have a zero final total and no delivery. Drivers record cash collected, start delivery, mark it delivered, or record a failed attempt with a reason. Failed deliveries can be retried. Shopping records, cash collection and delivery can be completed after the market closes.

**Operations → Orders** assigns or replaces a driver on an individual active order. In-progress orders require a replacement driver with complete details. Coordinate groceries and cash before reassigning. Existing purchases and delivery/cash progress are preserved, and the previous driver loses access to that order.

Driver API contracts:

- `driver.orderGroups({ view, marketId?, limit?, offset?, orderLimit? })`: returns `markets`, `totalGroups`, `hasMore`, and `nextOffset`. Each market includes date groups with their run and an initial order `page`. `limit` counts market dates (default 5, max 20); `orderLimit` bounds each date's initial orders (default 25, max 100).
- `driver.orders({ runId, view, limit?, offset? })`: returns `{ items, total, hasMore, nextOffset }` for one date. This replaces the previous flat cross-market order-list response; clients must supply `runId`.
- `driver.claimBatch({ runId, orderIds })`: accepts 1–100 unique order IDs for one market date. Returns one `results` entry per requested order, in request order: `claimed`, `already_claimed`, or `failed` with a stable `code` and readable `message`. Missing and cross-date IDs both return `NOT_FOUND`. Business conflicts affect only those selections; valid orders are claimed together in one database transaction. Authentication/driver failures reject the request; unexpected database failures roll the whole transaction back.
- `driver.claim({ id })`: retains the single-order contract and uses the same claim implementation. Retrying an order already owned by the caller, including after shopping or delivery, does not add duplicate claim events.
- `driver.shoppingList({ runId })`: returns all assigned, non-cancelled orders for one date, vendor/product totals and per-order allocations, without an order-page limit. Delivered orders appear only in packing history.
- `driver.startShoppingBatch({ runId })` / `driver.finishShoppingBatch({ runId })`: begin claimed orders or finalize shopping orders for that driver/date; retries do not duplicate status events.
- `driver.combinedPurchase({ runId, inventoryId, quantity, totalCostCents, allocations })`: saves one product's cumulative purchase across all that driver's currently shopping order lines. Each allocation includes `orderItemId`, `quantity`, and the nullable `expectedPurchaseUpdatedAt` from the shopping-list query. A maximum of 1,000 unique lines is accepted per save. Missing, stale, cross-date or reassigned lines reject the transaction. Exact-cent costs are stored on the individual purchases.
- `driver.setPacked({ orderId, orderItemId, packed })`: persists or clears an order-item packing check after shopping.

Claims hold a shared market-date lock, check the driver once, and lock selected order rows in ID order. Independent claims can proceed together; date cancellation/closing still acquire the exclusive date lock. Customer profile updates, driver details, invitations and token mutations also go through shared operations instead of writing directly in router handlers. Administrator invitation/token changes produce audit events. Invitation-only signup and driver enrollment are unchanged.

### Operations

Create market locations with IANA timezones, then schedule explicit dated runs with market hours, an order cutoff, a delivery window, and a delivery fee. The UI labels the device timezone used for date input; stored timestamps are absolute instants and customer schedules are shown in the market timezone.

Use **Operations → Farms** to create and edit reusable farms/vendors, contact phone numbers and shopping notes, or archive a farm. Archiving hides its offerings from new customer orders; existing orders preserve vendor snapshots and remain fulfillable. Use **Inventory** to add/edit catalog items linked to a farm and publish quantities and unit prices per market date. The inventory list includes hidden items and offers **Edit inventory**. Prices and stock used for checkout come from the dated inventory; legacy catalog price/quantity fields are not used. Inventory is locked after cutoff, and quantities cannot be reduced below existing reservations. Price changes do not alter existing orders. Cancelling a scheduled market date cancels orders that have not started shopping and releases reservations. A date containing orders already being fulfilled cannot be cancelled wholesale.

Manage invitations, driver approval/suspension, and MCP tokens. Network administrators manage network membership through **Configure** or MCP; global administrator roles are assigned by the trusted CLI. Public profile forms cannot grant administrator access. See [administrator roles](networks.md#administrator-roles).

## Related guides

- [App configuration](configuration.md)
- [Recurring schedules and market closing](jobs.md)
- [MCP tools](mcp.md)
