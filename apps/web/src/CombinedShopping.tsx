import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import {
  ErrorState,
  label,
  Loading,
  money,
  Panel,
  useAction,
  when,
} from './ui';

type Trip = Awaited<ReturnType<typeof rpc.driver.shoppingList.query>>;
type Product = Trip['vendors'][number]['items'][number];
type PurchaseInput = Parameters<typeof rpc.driver.combinedPurchase.mutate>[0];

export function CombinedShopping({
  runId,
  onBack,
}: {
  runId: string;
  onBack: () => void;
}) {
  const query = useQuery(
    api.driver.shoppingList.queryOptions({ runId }, { refetchInterval: 15000 }),
  );
  const { act, busy, notice } = useAction();
  const [packingDraft, setPackingDraft] = useState<Record<string, boolean>>({});
  if (query.isPending)
    return (
      <div className="workspace">
        <button className="secondary" onClick={onBack}>
          Back to My orders
        </button>
        <Loading />
      </div>
    );
  if (query.isError)
    return (
      <div className="workspace">
        <button className="secondary" onClick={onBack}>
          Back to My orders
        </button>
        <ErrorState error={query.error} />
      </div>
    );
  const trip = query.data;
  const products = trip.vendors.flatMap((vendor) => vendor.items);
  const unrecorded = products.reduce(
    (count, product) =>
      count +
      product.allocations.filter(
        (line) => line.status === 'shopping' && line.purchasedQuantity === null,
      ).length,
    0,
  );
  const open =
    new Date(trip.run.startsAt) <= new Date() &&
    new Date(trip.run.endsAt) > new Date() &&
    trip.run.status !== 'cancelled';
  const packing = trip.orders.filter(
    (order) => !['claimed', 'shopping'].includes(order.status),
  );
  return (
    <div className="workspace combined-shopping">
      <button className="secondary" onClick={onBack} disabled={busy}>
        Back to My orders
      </button>
      <button
        className="secondary"
        disabled={busy || query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh shopping list
      </button>
      <div className="page-heading">
        <p className="eyebrow">ONE TRIP, ALL YOUR ORDERS</p>
        <h1>Combined shopping list</h1>
        <h2>{trip.market.name}</h2>
        <p>{trip.market.address}</p>
        <p>
          {when(trip.run.startsAt, trip.market.timezone)} · {trip.orders.length}{' '}
          assigned {trip.orders.length === 1 ? 'order' : 'orders'}
        </p>
      </div>
      {notice}
      <Panel title="Shop this market">
        <p>
          Buy by vendor, then pack by customer. This list includes every order
          assigned to you for this date, across all order pages.
        </p>
        <div className="shopping-trip-actions">
          <button
            disabled={busy || !trip.claimedOrderCount || !open}
            onClick={() =>
              void act(
                () => rpc.driver.startShoppingBatch.mutate({ runId }),
                'Shopping started for your claimed orders',
              )
            }
          >
            Start shopping for all claimed orders ({trip.claimedOrderCount})
          </button>
          <button
            className="secondary"
            disabled={busy || !trip.shoppingOrderCount || unrecorded > 0}
            onClick={() =>
              void act(
                () => rpc.driver.finishShoppingBatch.mutate({ runId }),
                'Shopping finalized; pack each customer’s order below',
              )
            }
          >
            Finish shopping ({trip.shoppingOrderCount} orders)
          </button>
        </div>
        {trip.claimedOrderCount > 0 && !open && (
          <p className="muted">
            New shopping can only start while the market is open.
          </p>
        )}
        {unrecorded > 0 && (
          <p className="muted">
            Record every item before finishing, including zero quantity and zero
            cost for unavailable items.
          </p>
        )}
      </Panel>
      <div className="shopping-vendors">
        {trip.vendors.map((vendor) => (
          <section
            className="panel shopping-vendor"
            key={vendor.farmId}
            aria-label={`Vendor ${vendor.name}`}
          >
            <div className="shopping-vendor-heading">
              <div>
                <p className="eyebrow">VENDOR</p>
                <h2>{vendor.name}</h2>
                <p>{vendor.location}</p>
              </div>
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`}>{vendor.phone}</a>
              )}
            </div>
            {vendor.notes && <p className="muted">{vendor.notes}</p>}
            {vendor.items.map((product) => {
              const editing = product.allocations.filter(
                (line) => line.status === 'shopping',
              );
              const key =
                product.inventoryId +
                '-' +
                editing
                  .map(
                    (line) => `${line.orderItemId}:${line.purchaseUpdatedAt}`,
                  )
                  .join('|');
              return (
                <article
                  className="combined-product"
                  key={product.inventoryId}
                  aria-label={`Shopping item ${product.name}`}
                >
                  <h3>{product.name}</h3>
                  <div className="shopping-quantities">
                    <span>
                      <strong>{product.requestedQuantity}</strong>{' '}
                      {product.unit} requested
                    </span>
                    <span>
                      <strong>{product.purchasedQuantity}</strong> bought
                    </span>
                    <span>
                      <strong>{product.remainingQuantity}</strong> to record
                    </span>
                    {product.shortageQuantity > 0 && (
                      <span>
                        <strong>{product.shortageQuantity}</strong> short
                      </span>
                    )}
                  </div>
                  {editing.length > 0 ? (
                    <CombinedPurchaseForm
                      key={key}
                      product={product}
                      runId={runId}
                      busy={busy}
                      onSave={(input) => {
                        void act(
                          () => rpc.driver.combinedPurchase.mutate(input),
                          'Combined purchase saved',
                        );
                      }}
                    />
                  ) : (
                    <>
                      <p className="muted">
                        {product.allocations.some(
                          (line) => line.status === 'claimed',
                        )
                          ? 'Start shopping to record this purchase.'
                          : 'Purchases recorded. Use the packing checklist below.'}
                      </p>
                      <details>
                        <summary>Quantities by customer</summary>
                        <ul>
                          {product.allocations.map((line) => (
                            <li key={line.orderItemId}>
                              {line.customerName} · Order{' '}
                              {line.orderId.slice(0, 8)}:{' '}
                              {line.purchasedQuantity ?? 'Pending'} /{' '}
                              {line.quantity} {product.unit} ·{' '}
                              {label(line.status)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </>
                  )}
                  {editing.length > 0 &&
                    product.allocations.some(
                      (line) => line.status !== 'shopping',
                    ) && (
                      <details>
                        <summary>Other orders for this item</summary>
                        <ul>
                          {product.allocations
                            .filter((line) => line.status !== 'shopping')
                            .map((line) => (
                              <li key={line.orderItemId}>
                                {line.customerName} · Order{' '}
                                {line.orderId.slice(0, 8)}:{' '}
                                {line.purchasedQuantity ?? 'Pending'} /{' '}
                                {line.quantity} {product.unit} ·{' '}
                                {label(line.status)}
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      <Panel title="Packing checklist">
        {!packing.length && (
          <p>Finish shopping to see what goes in each customer’s bag.</p>
        )}
        {packing.map((order) => {
          const bought = order.items.filter(
            (item) => (item.fulfilledQuantity ?? 0) > 0,
          );
          const packed = bought.filter(
            (item) => packingDraft[item.id] ?? !!item.packedAt,
          ).length;
          const editable = [
            'ready',
            'out_for_delivery',
            'delivery_failed',
          ].includes(order.status);
          return (
            <article
              className="packing-order"
              key={order.id}
              aria-label={`Packing order ${order.id.slice(0, 8)}`}
            >
              <div className="split-line">
                <h3>
                  {order.customerName} · Order {order.id.slice(0, 8)}
                </h3>
                <span className="badge">{label(order.status)}</span>
              </div>
              <p>{order.address}</p>
              <p>{order.deliveryNotes}</p>
              {bought.length > 0 ? (
                <>
                  <p>
                    <strong>
                      {packed} / {bought.length}{' '}
                      {bought.length === 1 ? 'item' : 'items'} packed
                    </strong>{' '}
                    · Customer total {money(order.actualTotalCents ?? 0)}
                  </p>
                  {bought.map((item) => (
                    <label className="packing-check" key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={`Packed ${item.name} for order ${order.id.slice(0, 8)}`}
                        checked={packingDraft[item.id] ?? !!item.packedAt}
                        disabled={busy || !editable}
                        onChange={(event) => {
                          const packed = event.target.checked;
                          setPackingDraft((current) => ({
                            ...current,
                            [item.id]: packed,
                          }));
                          void (async () => {
                            await act(
                              () =>
                                rpc.driver.setPacked.mutate({
                                  orderId: order.id,
                                  orderItemId: item.id,
                                  packed,
                                }),
                              'Packing checklist saved',
                            );
                            setPackingDraft((current) => {
                              const next = { ...current };
                              delete next[item.id];
                              return next;
                            });
                          })();
                        }}
                      />
                      <span>
                        <strong>
                          {item.fulfilledQuantity} {item.unit} {item.name}
                        </strong>
                        <small>{item.farmName}</small>
                      </span>
                    </label>
                  ))}
                </>
              ) : (
                <p>No items available. No delivery or payment is due.</p>
              )}
              {order.items.some(
                (item) =>
                  item.fulfilledQuantity !== null &&
                  item.fulfilledQuantity < item.quantity,
              ) && (
                <p className="muted">
                  Shortages:{' '}
                  {order.items
                    .filter(
                      (item) =>
                        item.fulfilledQuantity !== null &&
                        item.fulfilledQuantity < item.quantity,
                    )
                    .map(
                      (item) =>
                        `${item.name} (${item.quantity - (item.fulfilledQuantity ?? 0)} ${item.unit} short)`,
                    )
                    .join(', ')}
                </p>
              )}
            </article>
          );
        })}
      </Panel>
    </div>
  );
}

function CombinedPurchaseForm({
  product,
  runId,
  busy,
  onSave,
}: {
  product: Product;
  runId: string;
  busy: boolean;
  onSave: (input: PurchaseInput) => void;
}) {
  const lines = product.allocations.filter(
    (line) => line.status === 'shopping',
  );
  const allRecorded = lines.every((line) => line.purchasedQuantity !== null);
  const initial = Object.fromEntries(
    lines.map((line) => [
      line.orderItemId,
      allRecorded ? (line.purchasedQuantity ?? 0) : line.quantity,
    ]),
  );
  const [allocations, setAllocations] =
    useState<Record<string, number>>(initial);
  const [quantity, setQuantity] = useState(
    Object.values(initial).reduce((sum, value) => sum + value, 0),
  );
  const [cost, setCost] = useState(
    allRecorded
      ? String(
          lines.reduce((sum, line) => sum + (line.totalCostCents ?? 0), 0) /
            100,
        )
      : '',
  );
  const requested = lines.reduce((sum, line) => sum + line.quantity, 0);
  function suggest(total: number) {
    let remaining = total;
    const next: Record<string, number> = {};
    for (const line of lines) {
      next[line.orderItemId] = Math.min(line.quantity, remaining);
      remaining -= next[line.orderItemId]!;
    }
    setAllocations(next);
    setQuantity(total);
    if (total === 0) setCost('0');
  }
  return (
    <form
      className="combined-purchase-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          runId,
          inventoryId: product.inventoryId,
          quantity,
          totalCostCents: Math.round(Number(cost) * 100),
          allocations: lines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: allocations[line.orderItemId] ?? 0,
            expectedPurchaseUpdatedAt: line.purchaseUpdatedAt,
          })),
        });
      }}
    >
      <p className="muted">
        Enter the total bought so far for the {lines.length} orders still
        shopping ({requested} {product.unit} requested). Existing purchase
        records are included.
      </p>
      <div className="combined-purchase-fields">
        <label>
          Total purchased quantity
          <input
            aria-label={`Combined quantity for ${product.name}`}
            type="number"
            required
            min={0}
            max={requested}
            step={1}
            value={quantity}
            disabled={busy}
            onChange={(event) =>
              suggest(
                Math.max(0, Math.min(requested, Number(event.target.value))),
              )
            }
          />
        </label>
        <label>
          Total purchase cost ($)
          <input
            aria-label={`Combined cost for ${product.name}`}
            type="number"
            required
            min={0}
            max={1000000}
            step="0.01"
            value={cost}
            disabled={busy}
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
      </div>
      <details className="purchase-allocations">
        <summary>Review allocations to {lines.length} customer orders</summary>
        <p className="muted">
          Suggested quantities follow order-placement order. Adjust them before
          saving. Purchase costs are shared in proportion to these quantities;
          customer prices stay as ordered.
        </p>
        {lines.map((line) => (
          <label className="purchase-allocation" key={line.orderItemId}>
            <span>
              {line.customerName}
              <small>
                Order {line.orderId.slice(0, 8)} · {line.quantity}{' '}
                {product.unit} requested
              </small>
            </span>
            <input
              aria-label={`Allocate ${product.name} to order ${line.orderId.slice(0, 8)}`}
              type="number"
              required
              min={0}
              max={line.quantity}
              step={1}
              disabled={busy}
              value={allocations[line.orderItemId] ?? 0}
              onChange={(event) => {
                const next = {
                  ...allocations,
                  [line.orderItemId]: Number(event.target.value),
                };
                setAllocations(next);
                const total = Object.values(next).reduce(
                  (sum, value) => sum + value,
                  0,
                );
                setQuantity(total);
                if (total === 0) setCost('0');
              }}
            />
          </label>
        ))}
      </details>
      <button disabled={busy}>Save combined purchase</button>
    </form>
  );
}
