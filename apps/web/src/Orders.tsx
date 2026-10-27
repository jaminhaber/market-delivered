import { SupportContact } from './AppSettings';
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
export function Orders() {
  const orders = useQuery(
    api.orders.mine.queryOptions(undefined, { refetchInterval: 60000 }),
  );
  const { act, busy, notice } = useAction();
  return (
    <div className="workspace">
      <div className="page-heading">
        <p className="eyebrow">FROM THE MARKET TO YOU</p>
        <h1>Your orders</h1>
      </div>
      {notice}
      <SupportContact />
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} />
      ) : !orders.data.length ? (
        <Panel title="Your first market trip awaits">
          <p>Choose a market day and add some produce to your basket.</p>
        </Panel>
      ) : (
        orders.data.map((order) => (
          <Panel key={order.id} title={`Order ${order.id.slice(0, 8)}`}>
            <div className="split-line">
              <span className="badge">{label(order.status)}</span>
              <span>{when(order.createdAt)}</span>
            </div>
            {order.status === 'cancelled' && (
              <p className="notice">
                {order.events
                  .filter((event) => event.status === 'cancelled')
                  .at(-1)?.note || 'This order was cancelled.'}{' '}
                No further cash is due.
                {order.cashCollectedCents > 0 &&
                  ` Cash of ${money(order.cashCollectedCents)} was already recorded; contact the team to reconcile it.`}
              </p>
            )}
            <p>
              Deliver to <strong>{order.address}</strong>
            </p>
            <p className="muted">{order.deliveryNotes}</p>
            <p>
              Delivery window: {when(order.run.deliveryStartAt)} –{' '}
              {when(order.run.deliveryEndAt)}
            </p>
            {order.driver &&
              !['cancelled', 'unavailable'].includes(order.status) && (
                <p>
                  Your shopper: <strong>{order.driver.name}</strong> ·{' '}
                  <a href={`tel:${order.driver.phone}`}>{order.driver.phone}</a>
                </p>
              )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ITEM</th>
                    <th>ORDERED</th>
                    <th>FULFILLED</th>
                    <th>ORDERED TOTAL</th>
                    <th>FULFILLED TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.name}
                        <small className="muted"> · {item.farmName}</small>
                      </td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
                      <td>{item.fulfilledQuantity ?? 'Pending'}</td>
                      <td>{money(item.priceCents * item.quantity)}</td>
                      <td>
                        {item.fulfilledQuantity === null
                          ? 'Pending'
                          : money(item.fulfilledQuantity * item.priceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="basket-line">
              <span>Order total, including delivery</span>
              <strong>{money(order.estimatedTotalCents)}</strong>
            </p>
            <p className="basket-line">
              <span>Final total, including delivery</span>
              <strong>
                {order.status === 'cancelled'
                  ? 'Cancelled'
                  : order.actualTotalCents === null
                    ? 'After shopping'
                    : money(order.actualTotalCents)}
              </strong>
            </p>
            <p>
              Payment method: <strong>Cash</strong>
            </p>
            <p>
              Cash collected: {money(order.cashCollectedCents)}
              {order.status !== 'cancelled' &&
                order.actualTotalCents !== null &&
                ` · Cash outstanding: ${money(order.actualTotalCents - order.cashCollectedCents)}`}
            </p>
            <p className="muted">
              Prices are set when you order. You only pay for the quantity
              fulfilled, plus delivery.
            </p>
            {['placed', 'claimed'].includes(order.status) && (
              <button
                className="secondary"
                disabled={busy || new Date(order.run.cutoffAt) <= new Date()}
                onClick={() =>
                  void act(
                    () => rpc.orders.cancel.mutate({ id: order.id }),
                    'Order cancelled; stock released',
                  )
                }
              >
                Cancel order
              </button>
            )}
            <details>
              <summary>Order history</summary>
              <ol className="timeline">
                {order.events.map((e) => (
                  <li key={e.id}>
                    <strong>{label(e.status)}</strong> · {when(e.createdAt)}
                    {e.note && <p>{e.note}</p>}
                  </li>
                ))}
              </ol>
            </details>
          </Panel>
        ))
      )}
    </div>
  );
}
