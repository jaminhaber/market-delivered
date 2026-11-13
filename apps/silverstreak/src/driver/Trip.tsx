import { useEffect, useState } from 'react';
import { rpc } from './api';
import { label, money, Panel, useAction, when } from './ui';

type Trip = NonNullable<
  Awaited<ReturnType<typeof rpc.driver.workspace.query>>['trip']
>;
type Product = Trip['vendors'][number]['items'][number];
type PurchaseInput = Parameters<typeof rpc.driver.combinedPurchase.mutate>[0];
type Order = Trip['orders'][number];
type Step = 'shop' | 'pack' | 'deliver';
const steps: Step[] = ['shop', 'pack', 'deliver'];

export function TripWorkspace({
  trip,
  onFindOrders,
  onReleased,
}: {
  trip: Trip;
  onFindOrders: () => void;
  onReleased: () => void;
}) {
  const { act, busy, notice } = useAction();
  const [view, setView] = useState<Step | null>(null);
  const [deliveryId, setDeliveryId] = useState('');
  const progress = trip.progress;
  useEffect(() => {
    setView(null);
  }, [progress.step]);
  const current = view ?? progress.step;
  const nextBag = trip.orders.find(
    (order) =>
      ['ready', 'out_for_delivery', 'delivery_failed'].includes(order.status) &&
      order.items.some(
        (item) => (item.fulfilledQuantity ?? 0) > 0 && !item.packedAt,
      ),
  );
  const deliveries = trip.orders.filter(
    (order) =>
      ['ready', 'out_for_delivery', 'delivery_failed'].includes(order.status) ||
      (order.status === 'delivered' &&
        order.cashCollectedCents < (order.actualTotalCents ?? 0)),
  );
  const delivery =
    deliveries.find((order) => order.id === deliveryId) ??
    deliveries.find((order) => order.status === 'out_for_delivery') ??
    deliveries.find((order) => order.status === 'ready') ??
    deliveries[0];
  const shoppingVendors = trip.vendors
    .map((vendor) => ({
      ...vendor,
      items: vendor.items.filter((product) =>
        product.allocations.some((line) =>
          ['claimed', 'shopping'].includes(line.status),
        ),
      ),
    }))
    .filter((vendor) => vendor.items.length);
  return (
    <>
      <header className="trip-heading">
        <p className="eyebrow">YOUR MARKET TRIP</p>
        <h1>{trip.market.name}</h1>
        <p>
          {when(trip.run.startsAt, trip.market.timezone)} ·{' '}
          {progress.ordersTotal}{' '}
          {progress.ordersTotal === 1 ? 'order' : 'orders'}
        </p>
        <p className="muted">{trip.market.address}</p>
      </header>
      <nav className="trip-steps" aria-label="Trip progress">
        {steps.map((step, index) => (
          <button
            key={step}
            aria-current={current === step ? 'step' : undefined}
            className={current === step ? '' : 'secondary'}
            disabled={
              busy ||
              (progress.step !== 'complete' &&
                index > steps.indexOf(progress.step))
            }
            onClick={() => setView(step)}
          >
            <span>{index + 1}</span>{' '}
            {step === 'shop' ? 'Shop' : step === 'pack' ? 'Pack' : 'Deliver'}
          </button>
        ))}
      </nav>
      {notice}
      {current === 'complete' && (
        <Panel title="Trip complete">
          <p>
            All {progress.deliveriesTotal}{' '}
            {progress.deliveriesTotal === 1 ? 'delivery is' : 'deliveries are'}{' '}
            complete. No cash is outstanding.
          </p>
          {trip.orders.some((order) => order.status === 'unavailable') && (
            <p>Unavailable orders have no delivery or payment due.</p>
          )}
          <button onClick={onFindOrders}>Find orders</button>
        </Panel>
      )}
      {current === 'shop' && (
        <>
          <section className="trip-progress" aria-label="Shopping progress">
            <strong>
              Shopping · {progress.shoppingItemsRecorded} of{' '}
              {progress.shoppingItemsTotal} items recorded
            </strong>
            <progress
              value={progress.shoppingItemsRecorded}
              max={Math.max(1, progress.shoppingItemsTotal)}
            />
            <p>Buy by vendor. Customer quantities are combined for you.</p>
          </section>
          {trip.claimedOrderCount > 0 && (
            <Panel title="Ready to shop?">
              <button
                disabled={busy || !trip.actions.startShopping}
                onClick={() =>
                  void act(
                    () =>
                      rpc.driver.startShoppingBatch.mutate({
                        runId: trip.run.id,
                      }),
                    'Shopping started',
                  )
                }
              >
                Start shopping
              </button>
              {!trip.actions.startShopping && (
                <p className="muted">
                  You can start when the market opens:{' '}
                  {when(trip.run.startsAt, trip.market.timezone)}.
                </p>
              )}
            </Panel>
          )}
          {shoppingVendors.map((vendor) => (
            <section
              key={vendor.farmId}
              className="panel shopping-vendor"
              aria-label={`Vendor ${vendor.name}`}
            >
              <header className="shopping-vendor-heading">
                <div>
                  <p className="eyebrow">VENDOR</p>
                  <h2>{vendor.name}</h2>
                  <p>{vendor.location}</p>
                </div>
                {vendor.phone && (
                  <a className="text-link" href={`tel:${vendor.phone}`}>
                    Call vendor
                  </a>
                )}
              </header>
              {vendor.notes && <p className="muted">{vendor.notes}</p>}
              {vendor.items.map((product) => {
                const lines = product.allocations.filter((line) =>
                  ['claimed', 'shopping'].includes(line.status),
                );
                const editing = lines.filter(
                  (line) => line.status === 'shopping',
                );
                const requested = lines.reduce(
                  (sum, line) => sum + line.quantity,
                  0,
                );
                return (
                  <article
                    className="combined-product"
                    aria-label={`Shopping item ${product.name}`}
                    key={product.inventoryId}
                  >
                    <h3>
                      {product.name}{' '}
                      <span className="item-quantity">
                        {requested} {product.unit}
                      </span>
                    </h3>
                    {editing.length > 0 ? (
                      <PurchaseForm
                        key={editing
                          .map(
                            (line) =>
                              `${line.orderItemId}:${line.purchaseUpdatedAt}`,
                          )
                          .join('|')}
                        product={product}
                        runId={trip.run.id}
                        busy={busy}
                        onSave={(input) =>
                          void act(
                            () => rpc.driver.combinedPurchase.mutate(input),
                            'Purchase saved',
                          )
                        }
                      />
                    ) : (
                      <p className="muted">
                        Start shopping to record this item.
                      </p>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
          {trip.shoppingOrderCount > 0 && (
            <div className="trip-next-action">
              <button
                disabled={busy || !trip.actions.finishShopping}
                onClick={() =>
                  void act(
                    () =>
                      rpc.driver.finishShoppingBatch.mutate({
                        runId: trip.run.id,
                      }),
                    'Shopping complete',
                  )
                }
              >
                Finish shopping
              </button>
              {!trip.actions.finishShopping && (
                <p className="muted">
                  {trip.claimedOrderCount
                    ? 'Start shopping for the remaining claimed orders first.'
                    : `Record ${progress.shoppingItemsTotal - progress.shoppingItemsRecorded} more items, including unavailable items.`}
                </p>
              )}
            </div>
          )}
          {!shoppingVendors.length && !trip.claimedOrderCount && (
            <p>
              Shopping is complete. Review customer quantities under View
              orders.
            </p>
          )}
        </>
      )}
      {current === 'pack' && (
        <>
          <section className="trip-progress" aria-label="Packing progress">
            <strong>
              Packing · {progress.packingItemsPacked} of{' '}
              {progress.packingItemsTotal} items packed
            </strong>
            <progress
              value={progress.packingItemsPacked}
              max={Math.max(1, progress.packingItemsTotal)}
            />
          </section>
          {nextBag ? (
            <Panel title={`Pack ${nextBag.customerName}’s bag`}>
              <p>{nextBag.address}</p>
              <BagItems order={nextBag} />
              <p>
                Check these quantities against the bag, then confirm it is
                packed.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => rpc.driver.packOrder.mutate({ orderId: nextBag.id }),
                    'Bag packed',
                  )
                }
              >
                Bag packed
              </button>
            </Panel>
          ) : (
            <Panel title="All bags packed">
              <button onClick={() => setView('deliver')}>
                Continue to delivery
              </button>
            </Panel>
          )}
        </>
      )}
      {current === 'deliver' && (
        <>
          <section className="trip-progress" aria-label="Delivery progress">
            <strong>
              Delivery · {progress.deliveriesCompleted} of{' '}
              {progress.deliveriesTotal} delivered
            </strong>
            <progress
              value={progress.deliveriesCompleted}
              max={Math.max(1, progress.deliveriesTotal)}
            />
          </section>
          {delivery ? (
            <DeliveryCard
              key={delivery.id}
              order={delivery}
              busy={busy}
              act={act}
            />
          ) : (
            <p>All deliveries are complete.</p>
          )}
          {deliveries.length > 1 && (
            <details className="trip-details">
              <summary>Choose another delivery ({deliveries.length})</summary>
              <div className="form-stack">
                {deliveries
                  .filter((order) => order.id !== delivery?.id)
                  .map((order) => (
                    <button
                      className="secondary"
                      key={order.id}
                      disabled={busy}
                      onClick={() => setDeliveryId(order.id)}
                    >
                      {order.customerName} · {label(order.status)}
                    </button>
                  ))}
              </div>
            </details>
          )}
        </>
      )}
      <details className="trip-details">
        <summary>View orders ({trip.orders.length})</summary>
        {trip.orders.map((order) => (
          <article className="order-overview" key={order.id}>
            <div className="split-line">
              <h3>{order.customerName}</h3>
              <span className="badge">{label(order.status)}</span>
            </div>
            <p>{order.address}</p>
            <BagItems order={order} />
            <p>
              {order.actualTotalCents === null
                ? 'Final total is calculated after shopping.'
                : `Total ${money(order.actualTotalCents)} · Cash recorded ${money(order.cashCollectedCents)}`}
            </p>
            {order.status === 'claimed' && (
              <button
                disabled={busy}
                className="secondary"
                onClick={() =>
                  void act(async () => {
                    await rpc.driver.release.mutate({ id: order.id });
                    onReleased();
                  }, 'Order released')
                }
              >
                Release order for {order.customerName}
              </button>
            )}
          </article>
        ))}
      </details>
      {progress.step !== 'complete' && (
        <button
          className="secondary find-more"
          disabled={busy}
          onClick={onFindOrders}
        >
          Find more orders
        </button>
      )}
    </>
  );
}

function BagItems({ order }: { order: Order }) {
  return (
    <ul className="bag-items">
      {order.items.map((item) => (
        <li key={item.id}>
          <strong>
            {item.fulfilledQuantity ?? item.quantity} {item.unit} {item.name}
          </strong>
          <small>
            {item.farmName}
            {item.fulfilledQuantity !== null &&
            item.fulfilledQuantity < item.quantity
              ? ` · ${item.quantity - item.fulfilledQuantity} ${item.unit} unavailable`
              : ''}
          </small>
        </li>
      ))}
    </ul>
  );
}

function DeliveryCard({
  order,
  busy,
  act,
}: {
  order: Order;
  busy: boolean;
  act: ReturnType<typeof useAction>['act'];
}) {
  const total = order.actualTotalCents ?? 0;
  const outstanding = Math.max(0, total - order.cashCollectedCents);
  const delivered = order.status === 'delivered';
  return (
    <Panel title={order.customerName}>
      {order.status === 'delivery_failed' && (
        <p className="notice">Delivery needs another attempt.</p>
      )}
      {delivered && <p>Delivered. Cash still needs to be settled.</p>}
      <p className="delivery-address">{order.address}</p>
      <div className="inline-actions">
        <a
          className="action-link"
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Directions
        </a>
        <a className="action-link" href={`tel:${order.phone}`}>
          Call customer
        </a>
      </div>
      {order.deliveryNotes && (
        <p className="delivery-notes">{order.deliveryNotes}</p>
      )}
      <p className="cash-due">
        Cash due <strong>{money(outstanding)}</strong>
      </p>
      {order.cashCollectedCents > 0 && (
        <p className="muted">
          Already recorded: {money(order.cashCollectedCents)} · Order total:{' '}
          {money(total)}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void act(
            () =>
              delivered
                ? rpc.orders.recordCash.mutate({
                    orderId: order.id,
                    amountCents: total,
                    note: 'Collected in full',
                  })
                : rpc.driver.completeDelivery.mutate({
                    orderId: order.id,
                    expectedTotalCents: total,
                    amountCents: total,
                    note: 'Collected in full',
                  }),
            delivered ? 'Cash recorded' : 'Delivery complete',
          )
        }
      >
        {busy
          ? 'Saving…'
          : delivered
            ? `Collected ${money(outstanding)}`
            : outstanding
              ? `Collected ${money(outstanding)} · Complete delivery`
              : 'Complete delivery'}
      </button>
      <details className="delivery-exceptions">
        <summary>Different cash amount or a delivery problem</summary>
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void act(
              () =>
                delivered
                  ? rpc.orders.recordCash.mutate({
                      orderId: order.id,
                      amountCents: Math.round(Number(data.get('amount')) * 100),
                      note: String(data.get('note')),
                    })
                  : rpc.driver.completeDelivery.mutate({
                      orderId: order.id,
                      expectedTotalCents: total,
                      amountCents: Math.round(Number(data.get('amount')) * 100),
                      note: String(data.get('note')),
                    }),
              delivered ? 'Cash recorded' : 'Delivery complete',
            );
          }}
        >
          <label>
            Total cash collected ($)
            <input
              name="amount"
              type="number"
              min={0}
              max={total / 100}
              step="0.01"
              required
              defaultValue={order.cashCollectedCents / 100}
              disabled={busy}
            />
          </label>
          <label>
            Cash note
            <input
              name="note"
              maxLength={500}
              required
              disabled={busy}
              defaultValue={order.cashNote}
            />
          </label>
          <button className="secondary" disabled={busy}>
            {delivered ? 'Save cash record' : 'Complete with this amount'}
          </button>
        </form>
        {!delivered && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void act(
                () =>
                  rpc.driver.reportDeliveryIssue.mutate({
                    orderId: order.id,
                    note: String(data.get('reason')),
                  }),
                'Delivery issue recorded',
              );
            }}
          >
            <label>
              Delivery problem
              <textarea
                name="reason"
                maxLength={500}
                required
                disabled={busy}
              />
            </label>
            <button className="secondary" disabled={busy}>
              Report delivery problem
            </button>
          </form>
        )}
      </details>
    </Panel>
  );
}

function PurchaseForm({
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
  const [editing, setEditing] = useState(!allRecorded);
  if (!editing)
    return (
      <div className="saved-purchase">
        <p>
          <strong>
            Saved · {quantity} {product.unit}
          </strong>{' '}
          · {money(Number(cost) * 100)}
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          Edit purchase
        </button>
      </div>
    );
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
      <div className="combined-purchase-fields">
        <label>
          Quantity bought
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
          Total cost ($)
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
        <summary>Shortage or adjust by customer</summary>
        <p className="muted">
          Suggested quantities follow order-placement order. Adjust them before
          saving. Purchase costs are shared in proportion to these quantities;
          customer prices stay as ordered.
        </p>
        {lines.map((line) => (
          <label className="purchase-allocation" key={line.orderItemId}>
            <span>
              {line.customerName}
              {line.isOwnOrder && ' (Your order)'}
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
      <div className="inline-actions">
        <button disabled={busy}>{busy ? 'Saving…' : 'Record purchase'}</button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            onSave({
              runId,
              inventoryId: product.inventoryId,
              quantity: 0,
              totalCostCents: 0,
              allocations: lines.map((line) => ({
                orderItemId: line.orderItemId,
                quantity: 0,
                expectedPurchaseUpdatedAt: line.purchaseUpdatedAt,
              })),
            })
          }
        >
          Unavailable
        </button>
      </div>
    </form>
  );
}
