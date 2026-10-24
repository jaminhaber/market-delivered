import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient, rpc } from './api';
import { CombinedShopping } from './CombinedShopping';
import {
  ErrorState,
  label,
  Loading,
  money,
  Panel,
  useAction,
  when,
} from './ui';

type DriverMarketGroup = Awaited<
  ReturnType<typeof rpc.driver.orderGroups.query>
>['markets'][number];
type DriverDateGroup = DriverMarketGroup['dates'][number];

export function Driver() {
  const [view, setView] = useState<'available' | 'mine'>('available');
  const [offset, setOffset] = useState(0);
  const [marketId, setMarketId] = useState('');
  const markets = useQuery(api.markets.list.queryOptions());
  const [selected, setSelected] = useState('');
  const [shoppingRunId, setShoppingRunId] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const orders = useQuery(
    api.driver.orderGroups.queryOptions(
      {
        view,
        marketId: marketId || undefined,
        limit: 5,
        offset,
        orderLimit: 25,
      },
      { refetchInterval: 15000 },
    ),
  );
  useEffect(() => {
    const total = orders.data?.totalGroups;
    if (total !== undefined && offset > 0 && offset >= total) {
      setOffset(Math.max(0, Math.floor((total - 1) / 5) * 5));
      setChecked([]);
    }
  }, [orders.data?.totalGroups, offset]);
  const { act, busy, notice } = useAction();
  function changePage(next: number) {
    setOffset(next);
    setChecked([]);
  }
  function toggle(ids: string[], on: boolean) {
    setChecked((current) =>
      on
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  }
  function claimSelected(runId: string, orderIds: string[]) {
    void act(
      async () => {
        const { results } = await rpc.driver.claimBatch.mutate({
          runId,
          orderIds,
        });
        const claimed = results
          .filter((result) => result.status !== 'failed')
          .map((result) => result.orderId);
        setChecked((current) => current.filter((id) => !claimed.includes(id)));
        const failures = results.filter((result) => result.status === 'failed');
        if (failures.length) {
          await queryClient.invalidateQueries();
          throw new Error(
            `Claimed ${claimed.length} of ${orderIds.length} orders. ${failures.length} could not be claimed. ${failures[0]!.message}`,
          );
        }
      },
      `${orderIds.length} ${orderIds.length === 1 ? 'order' : 'orders'} claimed. Open My orders to start shopping.`,
    );
  }
  function claimOne(id: string) {
    void act(async () => {
      await rpc.driver.claim.mutate({ id });
      setView('mine');
      changePage(0);
      setSelected(id);
    }, 'Order claimed');
  }
  const groups = orders.data?.markets ?? [];
  if (shoppingRunId)
    return (
      <CombinedShopping
        runId={shoppingRunId}
        onBack={() => setShoppingRunId('')}
      />
    );
  return (
    <div className="workspace">
      <div className="page-heading">
        <p className="eyebrow">SHOP LOCAL, DELIVER WITH CARE</p>
        <h1>Driver dashboard</h1>
        <p>
          Choose a market, select the orders you can deliver, and claim them
          together.
        </p>
      </div>
      <div className="subnav">
        {(['available', 'mine'] as const).map((v) => (
          <button
            key={v}
            className={view === v ? '' : 'secondary'}
            aria-pressed={view === v}
            disabled={busy}
            onClick={() => {
              setView(v);
              changePage(0);
              setSelected('');
            }}
          >
            {v === 'available' ? 'Available orders' : 'My orders'}
          </button>
        ))}
      </div>
      <label className="driver-market-filter">
        Filter by market
        <select
          aria-label="Filter by market"
          value={marketId}
          onChange={(event) => {
            setMarketId(event.target.value);
            changePage(0);
            setSelected('');
          }}
          disabled={busy || markets.isPending}
        >
          <option value="">All markets</option>
          {markets.data?.map((market) => (
            <option key={market.id} value={market.id}>
              {market.name}
            </option>
          ))}
        </select>
      </label>
      {markets.isError && <ErrorState error={markets.error} />}
      {notice}
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} />
      ) : (
        <div className={view === 'mine' ? 'driver-layout' : 'driver-browse'}>
          <div className="driver-market-list">
            {!groups.length && (
              <Panel
                title={
                  view === 'available'
                    ? 'No orders available'
                    : 'No orders on this page'
                }
              >
                <p>
                  {view === 'available'
                    ? 'Check back soon for orders from your local markets.'
                    : 'Claim orders from the Available orders tab to build your market trip.'}
                </p>
              </Panel>
            )}
            {groups.map(({ market, dates, orderCount }) => (
              <section
                className="driver-market"
                key={market.id}
                aria-labelledby={`driver-market-${market.id}`}
              >
                <header className="driver-market-heading">
                  <div>
                    <p className="eyebrow">MARKET PICKUP</p>
                    <h2 id={`driver-market-${market.id}`}>{market.name}</h2>
                    <p>{market.address}</p>
                  </div>
                  <span className="badge">
                    {orderCount} {orderCount === 1 ? 'order' : 'orders'} across
                    these dates
                  </span>
                </header>
                {dates.map((date) => (
                  <DriverDate
                    key={`${view}-${date.run.id}`}
                    market={market}
                    date={date}
                    view={view}
                    checked={checked}
                    selected={selected}
                    busy={busy}
                    onToggle={toggle}
                    onOpen={setSelected}
                    onClaim={claimOne}
                    onClaimBatch={claimSelected}
                    onShopping={setShoppingRunId}
                  />
                ))}
              </section>
            ))}
            <div className="driver-pagination">
              <p className="muted">
                {orders.data.totalGroups} market dates · Up to 5 dates per page.
                Browse more orders within each date.
              </p>
              <div className="inline-actions">
                <button
                  className="secondary"
                  disabled={busy || offset === 0}
                  onClick={() => changePage(Math.max(0, offset - 5))}
                >
                  Previous
                </button>
                <button
                  className="secondary"
                  disabled={busy || !orders.data.hasMore}
                  onClick={() => changePage(orders.data.nextOffset!)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          {view === 'mine' &&
            (selected ? (
              <DriverOrder key={selected} id={selected} />
            ) : (
              <Panel title="Your market trip">
                <p>
                  Open an order to see its shopping list and delivery details.
                  Your orders are grouped by market and date.
                </p>
              </Panel>
            ))}
        </div>
      )}
    </div>
  );
}
function DriverDate({
  market,
  date,
  view,
  checked,
  selected,
  busy,
  onToggle,
  onOpen,
  onClaim,
  onClaimBatch,
  onShopping,
}: {
  market: DriverMarketGroup['market'];
  date: DriverDateGroup;
  view: 'available' | 'mine';
  checked: string[];
  selected: string;
  busy: boolean;
  onToggle: (ids: string[], on: boolean) => void;
  onOpen: (id: string) => void;
  onClaim: (id: string) => void;
  onClaimBatch: (runId: string, ids: string[]) => void;
  onShopping: (runId: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const run = date.run;
  const pageQuery = useQuery(
    api.driver.orders.queryOptions(
      { runId: run.id, view, limit: 25, offset },
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
        {view === 'mine' && (
          <button className="secondary" onClick={() => onShopping(run.id)}>
            Combined shopping list
          </button>
        )}
        {view === 'available' && (
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
        )}
      </div>
      {offset > 0 && pageQuery.isPending ? (
        <Loading />
      ) : offset > 0 && pageQuery.isError ? (
        <ErrorState error={pageQuery.error} />
      ) : (
        <div className="driver-order-list">
          {items.map((order) => (
            <article
              className={`run-card driver-order-row ${selected === order.id ? 'selected' : ''}`}
              key={order.id}
            >
              {view === 'available' && (
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
              )}
              <div className="driver-order-summary">
                <div className="split-line">
                  <h4>Order {order.id.slice(0, 8)}</h4>
                  {view === 'mine' && (
                    <span className="badge">{label(order.status)}</span>
                  )}
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
              {view === 'mine' ? (
                <button className="secondary" onClick={() => onOpen(order.id)}>
                  Open order
                </button>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onClaim(order.id)}
                >
                  Claim order
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {view === 'available' && (
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
      )}
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
function DriverOrder({ id }: { id: string }) {
  const detail = useQuery(
    api.driver.detail.queryOptions({ id }, { refetchInterval: 15000 }),
  );
  const { act, busy, notice } = useAction();
  const [note, setNote] = useState('');
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} />;
  const order = detail.data;
  return (
    <div>
      {notice}
      <Panel title={`Order ${id.slice(0, 8)}`}>
        {order.isOwnOrder && <span className="badge">Your order</span>}
        <span className="badge">{label(order.status)}</span>
        <h3>{order.market.name}</h3>
        <p>{order.market.address}</p>
        <p>
          Market hours: {when(order.run.startsAt, order.market.timezone)} –{' '}
          {when(order.run.endsAt, order.market.timezone)}
        </p>
        {order.status === 'claimed' && (
          <>
            <p>
              Start shopping when the market opens. Release the order if you
              cannot fulfill it.
            </p>
            <div className="inline-actions">
              <button
                disabled={
                  busy ||
                  new Date(order.run.startsAt) > new Date() ||
                  new Date(order.run.endsAt) <= new Date()
                }
                onClick={() =>
                  void act(
                    () => rpc.driver.start.mutate({ id }),
                    'Shopping started',
                  )
                }
              >
                Start shopping
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => rpc.driver.release.mutate({ id }),
                    'Order released',
                  )
                }
              >
                Release order
              </button>
            </div>
          </>
        )}
        {order.status === 'shopping' && (
          <>
            <p>
              Record what you bought for this customer. For an unavailable item,
              enter zero quantity and zero cost. Review each item before
              finishing.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () => rpc.driver.finish.mutate({ id }),
                  'Shopping complete; order is ready',
                )
              }
            >
              Finish shopping
            </button>
          </>
        )}
        {order.status === 'delivered' && <p>Delivery complete. Thank you!</p>}
        {order.status === 'unavailable' && (
          <p>No items were available. No payment is due.</p>
        )}
      </Panel>
      <Panel title="Shopping list">
        {order.items.map((item) =>
          order.status === 'shopping' ? (
            <PurchaseRow key={item.id} orderId={id} item={item} />
          ) : (
            <article className="list-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.farmName} · {item.farmLocation}
                </p>
                <p>
                  {item.fulfilledQuantity === null
                    ? `${item.quantity} ${item.unit} requested`
                    : `${item.fulfilledQuantity} / ${item.quantity} ${item.unit} purchased`}
                </p>
              </div>
            </article>
          ),
        )}
      </Panel>
      <Panel title="Customer delivery">
        <h3>{order.customerName}</h3>
        <p>{order.address}</p>
        <p>
          <a href={`tel:${order.phone}`}>{order.phone}</a>
        </p>
        <p>{order.deliveryNotes}</p>
        <p>
          Delivery window:{' '}
          {when(order.run.deliveryStartAt, order.market.timezone)} –{' '}
          {when(order.run.deliveryEndAt, order.market.timezone)}
        </p>
        {order.actualTotalCents !== null && <CashRecord order={order} />}
        {['ready', 'delivery_failed'].includes(order.status) && (
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  rpc.driver.deliver.mutate({
                    orderId: id,
                    status: 'out_for_delivery',
                    note: '',
                  }),
                'Delivery started',
              )
            }
          >
            {order.status === 'delivery_failed'
              ? 'Retry delivery'
              : 'Start delivery'}
          </button>
        )}
        {order.status === 'out_for_delivery' && (
          <div className="form-stack">
            <label>
              Delivery note
              <input
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="inline-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      rpc.driver.deliver.mutate({
                        orderId: id,
                        status: 'delivered',
                        note,
                      }),
                    'Delivery completed',
                  )
                }
              >
                Mark delivered
              </button>
              <button
                className="secondary"
                disabled={busy || !note.trim()}
                onClick={() =>
                  void act(
                    () =>
                      rpc.driver.deliver.mutate({
                        orderId: id,
                        status: 'delivery_failed',
                        note,
                      }),
                    'Delivery issue recorded',
                  )
                }
              >
                Report failed delivery
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
type ShoppingItem = Awaited<
  ReturnType<typeof rpc.driver.detail.query>
>['items'][number];
function PurchaseRow({
  orderId,
  item,
}: {
  orderId: string;
  item: ShoppingItem;
}) {
  const [quantity, setQuantity] = useState(
    item.purchase?.quantity ?? item.quantity,
  );
  const [cost, setCost] = useState(
    item.purchase ? String(item.purchase.totalCostCents / 100) : '',
  );
  const { act, busy, notice } = useAction();
  return (
    <form
      className="purchase-row"
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          () =>
            rpc.driver.purchase.mutate({
              orderId,
              orderItemId: item.id,
              quantity,
              totalCostCents: Math.round(Number(cost) * 100),
            }),
          'Purchase recorded',
        );
      }}
    >
      <div>
        <h3>{item.name}</h3>
        <p>
          {item.farmName} · {item.farmLocation}
        </p>
        <p>
          {item.farmContactPhone && (
            <a href={`tel:${item.farmContactPhone}`}>{item.farmContactPhone}</a>
          )}{' '}
          {item.farmNotes}
        </p>
        <p>
          Need {item.quantity} {item.unit}{' '}
          {item.purchase && <span className="badge">Recorded</span>}
        </p>
      </div>
      <label>
        Purchased quantity
        <input
          aria-label={`Purchased quantity for ${item.name}`}
          type="number"
          required
          min={0}
          max={item.quantity}
          value={quantity}
          onChange={(e) => {
            const n = Number(e.target.value);
            setQuantity(n);
            if (n === 0) setCost('0');
          }}
        />
      </label>
      <label>
        Total cost ($)
        <input
          aria-label={`Total cost for ${item.name}`}
          type="number"
          required
          min={0}
          max={1000000}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </label>
      <button disabled={busy}>Record purchase</button>
      {notice}
    </form>
  );
}

function CashRecord({
  order,
}: {
  order: Awaited<ReturnType<typeof rpc.driver.detail.query>>;
}) {
  const { act, busy, notice } = useAction();
  if (['cancelled', 'unavailable'].includes(order.status))
    return (
      <p>
        No cash due.
        {order.cashCollectedCents > 0 &&
          ` Already recorded: ${money(order.cashCollectedCents)}; contact operations to reconcile.`}
      </p>
    );
  return (
    <div>
      <p>
        <strong>Cash due: {money(order.actualTotalCents ?? 0)}</strong> ·
        Collected: {money(order.cashCollectedCents)} · Outstanding:{' '}
        {money((order.actualTotalCents ?? 0) - order.cashCollectedCents)}
      </p>
      {notice}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          void act(
            () =>
              rpc.orders.recordCash.mutate({
                orderId: order.id,
                amountCents: Math.round(Number(values.get('amount')) * 100),
                note: String(values.get('note') ?? ''),
              }),
            'Cash record saved',
          );
        }}
      >
        <label>
          Cash collected ($)
          <input
            aria-label="Cash collected ($)"
            name="amount"
            type="number"
            required
            min={0}
            max={(order.actualTotalCents ?? 0) / 100}
            step="0.01"
            defaultValue={order.cashCollectedCents / 100}
          />
        </label>
        <label>
          Cash note
          <input
            aria-label="Cash note"
            name="note"
            maxLength={500}
            defaultValue={order.cashNote}
          />
        </label>
        <button disabled={busy}>Save cash record</button>
      </form>
    </div>
  );
}
