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
export function Driver() {
  const runs = useQuery(
    api.driver.runs.queryOptions(undefined, { refetchInterval: 60000 }),
  );
  const me = useQuery(api.me.queryOptions());
  const [selected, setSelected] = useState('');
  const { act, busy, notice } = useAction();
  return (
    <div className="workspace">
      <div className="page-heading">
        <p className="eyebrow">ONE TRIP, MANY GOOD THINGS</p>
        <h1>Driver dashboard</h1>
      </div>
      {notice}
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <ErrorState error={runs.error} />
      ) : (
        <div className="driver-layout">
          <div className="run-cards">
            {!runs.data.length && <p>No market runs are available yet.</p>}
            {runs.data.map(({ run, market }) => (
              <article
                className={`run-card ${selected === run.id ? 'selected' : ''}`}
                key={run.id}
              >
                <span className="badge">{label(run.status)}</span>
                <h3>{market.name}</h3>
                <p>{when(run.startsAt, market.timezone)}</p>
                <p>{market.address}</p>
                {run.driverId === me.data?.id ? (
                  <button
                    className="secondary"
                    onClick={() => setSelected(run.id)}
                  >
                    Open run
                  </button>
                ) : !run.driverId && run.status === 'scheduled' ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await rpc.driver.claim.mutate({ id: run.id });
                        setSelected(run.id);
                      }, 'Run claimed')
                    }
                  >
                    Claim run
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {selected ? (
            <DriverRun key={selected} id={selected} />
          ) : (
            <Panel title="Your market route">
              <p>
                Claim a run or open one of your runs to see the shopping list
                and deliveries.
              </p>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
function DriverRun({ id }: { id: string }) {
  const detail = useQuery(
    api.driver.detail.queryOptions({ id }, { refetchInterval: 60000 }),
  );
  const { act, busy, notice } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} />;
  const { run, orders, shopping } = detail.data;
  return (
    <div>
      {notice}
      <Panel title="Run progress">
        <span className="badge">{label(run.status)}</span>
        <p>Cutoff: {when(run.cutoffAt)}</p>
        {run.status === 'scheduled' && (
          <>
            <p>
              Shopping starts when the market opens and ordering has closed.
            </p>
            <button
              disabled={
                busy ||
                new Date(run.startsAt) > new Date() ||
                new Date(run.cutoffAt) > new Date()
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
          </>
        )}
        {run.status === 'shopping' && (
          <>
            <p>
              Record every item, including unavailable items at zero quantity
              and cost. Shortages go to orders in placement order. Review before
              finishing; allocation is final.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () => rpc.driver.finish.mutate({ id }),
                  'Shopping complete; deliveries are ready',
                )
              }
            >
              Finish shopping
            </button>
          </>
        )}
        {run.status === 'completed' && <p>All deliveries are complete.</p>}
      </Panel>
      {run.status === 'shopping' && (
        <Panel title="Combined shopping list">
          {!shopping.length && (
            <p>No produce to buy. Finish shopping to close this run.</p>
          )}
          {shopping.map((item) => (
            <PurchaseRow key={item.inventory.id} runId={id} item={item} />
          ))}
        </Panel>
      )}
      <Panel title="Deliveries">
        {!orders.length && <p>No customer orders for this run.</p>}
        {orders.map((order) => (
          <article className="delivery-card" key={order.id}>
            <div className="split-line">
              <h3>
                {order.customerName} · {order.id.slice(0, 8)}
              </h3>
              <span className="badge">{label(order.status)}</span>
            </div>
            <p>{order.address}</p>
            <p>
              <a href={`tel:${order.phone}`}>{order.phone}</a> ·{' '}
              {order.deliveryNotes}
            </p>
            <ul>
              {order.items.map((i) => (
                <li key={i.id}>
                  {i.name}: {i.fulfilledQuantity ?? i.quantity} / {i.quantity}{' '}
                  {i.unit}
                  {i.actualCostCents !== null &&
                    ` · purchase cost ${money(i.actualCostCents)}`}
                </li>
              ))}
            </ul>
            {order.actualTotalCents !== null && <CashRecord order={order} />}
            {run.status === 'delivering' && (
              <div className="form-stack">
                {['ready', 'delivery_failed'].includes(order.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          rpc.driver.deliver.mutate({
                            orderId: order.id,
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
                  <>
                    <label>
                      Delivery note
                      <input
                        aria-label={`Delivery note for ${order.id.slice(0, 8)}`}
                        value={notes[order.id] ?? ''}
                        onChange={(e) =>
                          setNotes({ ...notes, [order.id]: e.target.value })
                        }
                      />
                    </label>
                    <div className="inline-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              rpc.driver.deliver.mutate({
                                orderId: order.id,
                                status: 'delivered',
                                note: notes[order.id] ?? '',
                              }),
                            'Delivery completed',
                          )
                        }
                      >
                        Mark delivered
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !notes[order.id]?.trim()}
                        onClick={() =>
                          void act(
                            () =>
                              rpc.driver.deliver.mutate({
                                orderId: order.id,
                                status: 'delivery_failed',
                                note: notes[order.id] ?? '',
                              }),
                            'Delivery issue recorded',
                          )
                        }
                      >
                        Report failed delivery
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </Panel>
    </div>
  );
}
type ShoppingItem = Awaited<
  ReturnType<typeof rpc.driver.detail.query>
>['shopping'][number];
function PurchaseRow({ runId, item }: { runId: string; item: ShoppingItem }) {
  const [quantity, setQuantity] = useState(
      item.purchase?.quantity ?? item.inventory.reservedQuantity,
    ),
    [cost, setCost] = useState(
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
              runId,
              inventoryId: item.inventory.id,
              quantity,
              totalCostCents: Math.round(Number(cost) * 100),
            }),
          'Purchase recorded',
        );
      }}
    >
      <div>
        <h3>{item.produce.name}</h3>
        <p>
          Need {item.inventory.reservedQuantity} {item.produce.unit}{' '}
          {item.purchase && <span className="badge">Recorded</span>}
        </p>
      </div>
      <label>
        Purchased quantity
        <input
          aria-label={`Purchased quantity for ${item.produce.name}`}
          type="number"
          required
          min={0}
          max={item.inventory.reservedQuantity}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        />
      </label>
      <label>
        Total cost ($)
        <input
          aria-label={`Total cost for ${item.produce.name}`}
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
  order: Awaited<ReturnType<typeof rpc.driver.detail.query>>['orders'][number];
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
