import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { ErrorState, Loading, money, useAction, when } from './ui';
type DriverMarketGroup = Awaited<
  ReturnType<typeof rpc.driver.orderGroups.query>
>['markets'][number];
type DriverDateGroup = DriverMarketGroup['dates'][number];

export function AvailableOrders({
  onBack,
  onClaimed,
}: {
  onBack: () => void;
  onClaimed: (runId: string, message: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [marketId, setMarketId] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const markets = useQuery(api.markets.list.queryOptions());
  const orders = useQuery(
    api.driver.orderGroups.queryOptions(
      {
        view: 'available',
        marketId: marketId || undefined,
        limit: 5,
        offset,
        orderLimit: 25,
      },
      { refetchInterval: 15000 },
    ),
  );
  const { act, busy, notice } = useAction();
  function changePage(next: number) {
    setOffset(next);
    setChecked([]);
  }
  useEffect(() => {
    const total = orders.data?.totalGroups;
    if (total !== undefined && offset > 0 && offset >= total)
      changePage(Math.max(0, Math.floor((total - 1) / 5) * 5));
  }, [orders.data?.totalGroups, offset]);
  function toggle(ids: string[], on: boolean) {
    setChecked((current) =>
      on
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  }
  function claim(runId: string, orderIds: string[]) {
    void act(async () => {
      const { results } = await rpc.driver.claimBatch.mutate({
        runId,
        orderIds,
      });
      const successful = results.filter((result) => result.status !== 'failed');
      const failed = results.filter((result) => result.status === 'failed');
      if (!successful.length)
        throw new Error(failed[0]?.message || 'No orders could be claimed.');
      onClaimed(
        runId,
        `${successful.length} ${successful.length === 1 ? 'order' : 'orders'} added to your trip.${failed.length ? ` ${failed.length} could not be claimed: ${failed[0]!.message}` : ''}`,
      );
    }, 'Orders added to your trip');
  }
  return (
    <>
      <button className="secondary" disabled={busy} onClick={onBack}>
        Back to my trip
      </button>
      <div className="page-heading">
        <h1>Find orders</h1>
        <p>
          Choose the orders you can deliver. We’ll combine the shopping for you.
        </p>
      </div>
      {(markets.data?.length ?? 0) > 1 && (
        <label className="driver-market-filter">
          Filter by market
          <select
            value={marketId}
            disabled={busy}
            onChange={(event) => {
              setMarketId(event.target.value);
              changePage(0);
            }}
          >
            <option value="">All markets</option>
            {markets.data?.map((market) => (
              <option key={market.id} value={market.id}>
                {market.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {notice}
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} />
      ) : (
        <div className="driver-market-list">
          {!orders.data.markets.length && (
            <section className="panel">
              <h2>No orders available</h2>
              <p>Check back soon for orders from your local markets.</p>
            </section>
          )}
          {orders.data.markets.map(({ market, dates }) => (
            <section
              key={market.id}
              className="driver-market"
              aria-label={market.name}
            >
              <header className="driver-market-heading">
                <h2>{market.name}</h2>
                <p>{market.address}</p>
              </header>
              {dates.map((date) => (
                <DriverDate
                  key={date.run.id}
                  market={market}
                  date={date}
                  checked={checked}
                  busy={busy}
                  onToggle={toggle}
                  onClaim={(id) => claim(date.run.id, [id])}
                  onClaimBatch={claim}
                />
              ))}
            </section>
          ))}
          {(offset > 0 || orders.data.hasMore) && (
            <div className="inline-actions">
              <button
                className="secondary"
                disabled={busy || offset === 0}
                onClick={() => changePage(Math.max(0, offset - 5))}
              >
                Previous dates
              </button>
              <button
                className="secondary"
                disabled={busy || !orders.data.hasMore}
                onClick={() => changePage(orders.data!.nextOffset!)}
              >
                More dates
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function DriverDate({
  market,
  date,
  checked,
  busy,
  onToggle,
  onClaim,
  onClaimBatch,
}: {
  market: DriverMarketGroup['market'];
  date: DriverDateGroup;
  checked: string[];
  busy: boolean;
  onToggle: (ids: string[], on: boolean) => void;
  onClaim: (id: string) => void;
  onClaimBatch: (runId: string, ids: string[]) => void;
}) {
  const [offset, setOffset] = useState(0);
  const run = date.run;
  const pageQuery = useQuery(
    api.driver.orders.queryOptions(
      { runId: run.id, view: 'available', limit: 25, offset },
      { enabled: offset > 0, refetchInterval: 15000 },
    ),
  );
  const page = offset === 0 ? date.page : pageQuery.data;
  useEffect(() => {
    const total = page?.total;
    if (total !== undefined && offset > 0 && offset >= total)
      setOffset(Math.max(0, Math.floor((total - 1) / 25) * 25));
  }, [page?.total, offset]);
  const items = page?.items ?? [];
  const ids = items.map((order) => order.id);
  const chosen = items.filter((order) => checked.includes(order.id));
  const all = items.length > 0 && chosen.length === items.length;
  function changePage(next: number) {
    onToggle(ids, false);
    setOffset(next);
  }
  return (
    <section
      className="driver-market-date"
      key={run.id}
      aria-label={`${market.name} on ${when(run.startsAt, market.timezone)}`}
    >
      <div className="driver-date-heading">
        <div>
          <h3>{when(run.startsAt, market.timezone)}</h3>
          <p>
            {page?.total ?? date.page.total}{' '}
            {(page?.total ?? date.page.total) === 1 ? 'order' : 'orders'} ·{' '}
            {items.length
              ? `${offset + 1}–${offset + items.length} shown`
              : 'No orders on this page'}
          </p>
          <p>
            Delivery: {when(run.deliveryStartAt, market.timezone)} –{' '}
            {when(run.deliveryEndAt, market.timezone)}
          </p>
        </div>
        {
          <label className="driver-select-all">
            <input
              type="checkbox"
              disabled={busy}
              checked={all}
              ref={(element) => {
                if (element) element.indeterminate = chosen.length > 0 && !all;
              }}
              onChange={(event) => onToggle(ids, event.target.checked)}
            />
            Select all shown orders
          </label>
        }
      </div>
      {offset > 0 && pageQuery.isPending ? (
        <Loading />
      ) : offset > 0 && pageQuery.isError ? (
        <ErrorState error={pageQuery.error} />
      ) : (
        <div className="driver-order-list">
          {items.map((order) => (
            <article className="driver-order-row" key={order.id}>
              {
                <input
                  className="driver-order-checkbox"
                  type="checkbox"
                  aria-label={`Select order ${order.id.slice(0, 8)}`}
                  disabled={busy}
                  checked={checked.includes(order.id)}
                  onChange={(event) =>
                    onToggle([order.id], event.target.checked)
                  }
                />
              }
              <div className="driver-order-summary">
                <div className="split-line">
                  <h4>Order {order.id.slice(0, 8)}</h4>
                </div>
                {order.isOwnOrder && <span className="badge">Your order</span>}
                <p>
                  Deliver to{' '}
                  <strong>
                    {order.city} {order.postalCode}
                  </strong>
                </p>
                <p>
                  {order.itemCount} {order.itemCount === 1 ? 'unit' : 'units'} ·
                  Order estimate {money(order.estimatedTotalCents)} · Delivery
                  fee {money(order.deliveryFeeCents)}
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onClaim(order.id)}
              >
                Claim order
              </button>
            </article>
          ))}
        </div>
      )}
      {
        <div className="driver-claim-bar">
          <div>
            <strong>{chosen.length} selected</strong>
            <p>
              {chosen.length
                ? `${chosen.reduce((n, order) => n + (order.itemCount ?? 0), 0)} units · Delivery fees ${money(chosen.reduce((n, order) => n + order.deliveryFeeCents, 0))}`
                : 'Select orders to combine your market trip.'}
            </p>
          </div>
          <div className="inline-actions">
            {chosen.length > 0 && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onToggle(ids, false)}
              >
                Clear selection
              </button>
            )}
            <button
              disabled={busy || !chosen.length}
              onClick={() =>
                onClaimBatch(
                  run.id,
                  chosen.map((order) => order.id),
                )
              }
            >
              Claim selected ({chosen.length})
            </button>
          </div>
        </div>
      }
      {(offset > 0 || page?.hasMore) && (
        <div className="driver-date-pagination">
          <button
            className="secondary"
            disabled={busy || offset === 0}
            onClick={() => changePage(Math.max(0, offset - 25))}
          >
            Previous orders
          </button>
          <button
            className="secondary"
            disabled={
              busy || !page?.hasMore || (pageQuery.isFetching && offset > 0)
            }
            onClick={() => changePage(page!.nextOffset!)}
          >
            More orders
          </button>
        </div>
      )}
    </section>
  );
}
