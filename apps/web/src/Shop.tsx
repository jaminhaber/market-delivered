import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Leaf, Search } from 'lucide-react';
import { api, rpc } from './api';
import { MarketHero } from './MarketHero';
import { ErrorState, Loading, money, Panel, useAction, when } from './ui';
export function Shop({
  signedIn,
  onAccount,
  onOrders,
}: {
  signedIn: boolean;
  onAccount: () => void;
  onOrders: () => void;
}) {
  const runs = useQuery(
    api.markets.runs.queryOptions(undefined, { refetchInterval: 60000 }),
  );
  const [selected, setSelected] = useState('');
  const marketDropdown = useRef<HTMLDetailsElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const run = runs.data?.find((r) => r.id === selected) ?? runs.data?.[0];
  return (
    <>
      <MarketHero />
      <section id="market" className="market-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ONE MARKET TRIP. YOUR DOORSTEP.</p>
            <h2>The market</h2>
          </div>
          <p>Order ahead. We’ll shop local for you.</p>
        </div>
        {runs.isPending ? (
          <Loading />
        ) : runs.isError ? (
          <ErrorState error={runs.error} />
        ) : !runs.data.length ? (
          <div className="state">
            <Leaf size={30} />
            <h3>Our next market day is on its way.</h3>
            <p>The team will publish inventory and an ordering cutoff here.</p>
          </div>
        ) : (
          <>
            <details className="market-day-dropdown" ref={marketDropdown}>
              <summary aria-label="Market day">
                <span className="market-day-content">
                  <span className="market-day-title">
                    <strong>
                      {run &&
                        new Intl.DateTimeFormat('en-US', {
                          weekday: 'long',
                          month: 'short',
                          day: 'numeric',
                          timeZone: run.timezone,
                        }).format(new Date(run.startsAt))}
                    </strong>
                    <span className="market-day-countdown">
                      {run && fromNow(run.startsAt, now)}
                    </span>
                  </span>
                  <span className="market-day-location">
                    {run?.marketName} ·{' '}
                    {run?.marketAddress.split(',').slice(1).join(',').trim()}
                  </span>
                </span>
                <span aria-hidden="true" className="market-dropdown-chevron">
                  ⌄
                </span>
              </summary>
              <fieldset className="market-days">
                <legend>Choose your market day</legend>
                <p className="market-days-intro">
                  Upcoming markets in the next two weeks. Choose a day to browse
                  its produce and place an order.
                </p>
                {runs.data.map((r) => {
                  const date = new Intl.DateTimeFormat('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    timeZone: r.timezone,
                  }).format(new Date(r.startsAt));
                  const time = (value: string) =>
                    new Intl.DateTimeFormat('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: r.timezone,
                    }).format(new Date(value));
                  const location =
                    r.marketAddress.split(',').slice(1).join(',').trim() ||
                    r.marketAddress;
                  return (
                    <label
                      className={`market-day-row ${run?.id === r.id ? 'is-selected' : ''}`}
                      key={r.id}
                    >
                      <input
                        type="radio"
                        name="market-day"
                        value={r.id}
                        checked={run?.id === r.id}
                        onChange={() => {
                          setSelected(r.id);
                          if (marketDropdown.current) {
                            marketDropdown.current.open = false;
                            marketDropdown.current
                              .querySelector('summary')
                              ?.focus();
                          }
                        }}
                      />
                      <span className="market-day-content">
                        <span className="market-day-title">
                          <strong>{date}</strong>
                          <span className="market-day-countdown">
                            {fromNow(r.startsAt, now)}
                          </span>
                        </span>
                        <span className="market-day-location">
                          {location} · {r.marketName}
                        </span>
                        <span className="market-day-hours">
                          Market {time(r.startsAt)}–{time(r.endsAt)} · Delivery{' '}
                          {time(r.deliveryStartAt)}–{time(r.deliveryEndAt)}
                        </span>
                        <span className="market-day-cutoff">
                          Order by {when(r.cutoffAt, r.timezone)} ·{' '}
                          {fromNow(r.cutoffAt, now, 'Closes')}
                        </span>
                      </span>
                      <span className="market-day-selection">
                        {run?.id === r.id ? 'Selected' : 'Choose day'}
                      </span>
                    </label>
                  );
                })}
                <p className="market-days-intro">
                  Times are local to each market. Your order will be delivered
                  in the selected delivery window.
                </p>
              </fieldset>
            </details>
            {run && (
              <RunShop
                key={run.id}
                run={run}
                signedIn={signedIn}
                onAccount={onAccount}
                onOrders={onOrders}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
function fromNow(date: string, now: number, prefix = 'Starts') {
  const minutes = Math.ceil((new Date(date).getTime() - now) / 60000);
  if (minutes <= 0)
    return prefix === 'Closes' ? 'Ordering closed' : 'Starting now';
  if (minutes < 60) return `${prefix} in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${prefix} in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `${prefix} in ${days} ${days === 1 ? 'day' : 'days'}${hours % 24 ? ` ${hours % 24}h` : ''}`;
}
type Run = Awaited<ReturnType<typeof rpc.markets.runs.query>>[number];
function RunShop({
  run,
  signedIn,
  onAccount,
  onOrders,
}: {
  run: Run;
  signedIn: boolean;
  onAccount: () => void;
  onOrders: () => void;
}) {
  const stock = useQuery(api.markets.inventory.queryOptions({ id: run.id }));
  const [cart, setCart] = useState<Record<string, number>>({}),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('All produce');
  const [requestId] = useState(() => crypto.randomUUID());
  const { act, busy, notice } = useAction();
  const open =
    run.status === 'scheduled' && new Date(run.cutoffAt) > new Date();
  const items = stock.data ?? [];
  const chosen = items.filter((i) => (cart[i.id] ?? 0) > 0);
  const subtotal = chosen.reduce(
    (sum, i) => sum + i.priceCents * (cart[i.id] ?? 0),
    0,
  );
  const visible = items.filter(
    (i) =>
      (category === 'All produce' || i.category === category) &&
      `${i.name} ${i.source}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="run-summary">
        <div>
          <strong>{run.marketName}</strong>
          <p>{run.marketAddress}</p>
          <p>
            Market: {when(run.startsAt, run.timezone)} –{' '}
            {when(run.endsAt, run.timezone)}
          </p>
          <p>
            Delivery: {when(run.deliveryStartAt, run.timezone)} –{' '}
            {when(run.deliveryEndAt, run.timezone)}
          </p>
        </div>
        <div>
          <span className={`badge ${open ? '' : 'closed'}`}>
            {open ? 'Orders open' : 'Orders closed'}
          </span>
          <p>Order by {when(run.cutoffAt, run.timezone)}</p>
          <small>Times shown in {run.timezone}</small>
        </div>
      </div>
      {notice}
      <div className="filters">
        <div
          className="category-tabs"
          role="group"
          aria-label="Filter by category"
        >
          {['All produce', 'Vegetables', 'Fruit', 'Herbs'].map((c) => (
            <button
              key={c}
              className={category === c ? 'active' : ''}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search produce"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search produce or source…"
          />
        </label>
      </div>
      {stock.isPending ? (
        <Loading />
      ) : stock.isError ? (
        <ErrorState error={stock.error} />
      ) : (
        <div className="shop-layout">
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Market inventory"
          >
            <table>
              <caption className="sr-only">
                Inventory for this market run
              </caption>
              <thead>
                <tr>
                  <th>PRODUCE</th>
                  <th>PRICE / UNIT</th>
                  <th>AVAILABLE</th>
                  <th>QUANTITY</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="produce-cell">
                        <span
                          className={`produce-icon ${i.category.toLowerCase()}`}
                        >
                          <Leaf size={23} />
                        </span>
                        <div>
                          <strong className="produce-name">{i.name}</strong>
                          <span className="produce-description">
                            {i.description}
                          </span>
                          <small>{i.source}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {money(i.priceCents)} / {i.unit}
                    </td>
                    <td>
                      {i.availableQuantity > 0
                        ? `${i.availableQuantity} ${i.unit}`
                        : 'Sold out'}
                    </td>
                    <td>
                      <input
                        className="quantity"
                        aria-label={`Quantity for ${i.name}`}
                        type="number"
                        min={0}
                        max={Math.min(1000, i.availableQuantity)}
                        value={cart[i.id] ?? 0}
                        disabled={!open || !i.availableQuantity}
                        onChange={(e) =>
                          setCart({
                            ...cart,
                            [i.id]: Math.min(
                              i.availableQuantity,
                              Math.max(0, Math.floor(Number(e.target.value))),
                            ),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="state">No produce matches your search.</div>
            )}
          </div>
          <Panel title="Your basket">
            {chosen.length ? (
              chosen.map((i) => (
                <p key={i.id} className="basket-line">
                  <span>
                    {cart[i.id]} × {i.name}
                  </span>
                  <strong>{money((cart[i.id] ?? 0) * i.priceCents)}</strong>
                </p>
              ))
            ) : (
              <p className="muted">Choose a few fresh finds to get started.</p>
            )}
            <p className="basket-line">
              <span>Delivery</span>
              <span>{money(run.deliveryFeeCents)}</span>
            </p>
            <p className="basket-line basket-total">
              <strong>Cash total</strong>
              <strong>
                {money(subtotal + (chosen.length ? run.deliveryFeeCents : 0))}
              </strong>
            </p>
            <p className="muted">
              Pay cash using the prices shown here. If an item is unavailable,
              we reduce your total by the unfulfilled quantity.
            </p>
            <button
              disabled={busy || !chosen.length || !open}
              onClick={() => {
                if (!signedIn) {
                  onAccount();
                  return;
                }
                void act(async () => {
                  await rpc.orders.place.mutate({
                    runId: run.id,
                    requestId,
                    items: chosen.map((i) => ({
                      inventoryId: i.id,
                      quantity: cart[i.id]!,
                    })),
                  });
                  onOrders();
                }, 'Order placed');
              }}
            >
              {signedIn ? 'Place order' : 'Sign in to order'}
            </button>
          </Panel>
        </div>
      )}
    </>
  );
}
