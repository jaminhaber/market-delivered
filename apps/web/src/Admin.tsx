import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { ErrorState, label, Panel, useAction, when } from './ui';
import { RunDriverAssignment } from './RunDriverAssignment';
const value = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? '');
export function Admin() {
  const [tab, setTab] = useState('Markets');
  return (
    <div className="workspace">
      <div className="page-heading">
        <p className="eyebrow">KEEP THE NEIGHBORHOOD GROWING</p>
        <h1>Operations</h1>
      </div>
      <div className="subnav">
        {['Markets', 'Inventory', 'People', 'MCP access'].map((t) => (
          <button
            className={t === tab ? '' : 'secondary'}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Markets' ? (
        <MarketsAdmin />
      ) : tab === 'Inventory' ? (
        <InventoryAdmin />
      ) : tab === 'People' ? (
        <PeopleAdmin />
      ) : (
        <TokensAdmin />
      )}
    </div>
  );
}
function MarketsAdmin() {
  const markets = useQuery(api.markets.list.queryOptions()),
    runs = useQuery(api.admin.runs.queryOptions());
  const { act, busy, notice } = useAction();
  const createMarket = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void act(async () => {
      await rpc.admin.createMarket.mutate({
        name: value(form, 'name'),
        address: value(form, 'address'),
        timezone: value(form, 'timezone'),
      });
      form.reset();
    }, 'Market created');
  };
  const createRun = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void act(async () => {
      await rpc.admin.scheduleRun.mutate({
        marketId: value(form, 'marketId'),
        cutoffAt: new Date(value(form, 'cutoffAt')).toISOString(),
        startsAt: new Date(value(form, 'startsAt')).toISOString(),
        endsAt: new Date(value(form, 'endsAt')).toISOString(),
        deliveryStartAt: new Date(value(form, 'deliveryStartAt')).toISOString(),
        deliveryEndAt: new Date(value(form, 'deliveryEndAt')).toISOString(),
        deliveryFeeCents: Math.round(Number(value(form, 'fee')) * 100),
      });
      form.reset();
    }, 'Market day scheduled');
  };
  return (
    <>
      {notice}
      <div className="page-grid">
        <Panel title="Create a market">
          <form className="form-stack" onSubmit={createMarket}>
            <label>
              Market name
              <input name="name" required minLength={2} maxLength={150} />
            </label>
            <label>
              Market address
              <input name="address" required minLength={5} maxLength={500} />
            </label>
            <label>
              IANA timezone
              <input
                name="timezone"
                required
                defaultValue="America/Los_Angeles"
              />
            </label>
            <button disabled={busy}>Create market</button>
          </form>
        </Panel>
        <Panel title="Schedule a market day">
          <p className="muted">
            Enter dates in your device timezone (
            {Intl.DateTimeFormat().resolvedOptions().timeZone}). Customers see
            the market’s timezone.
          </p>
          <form className="form-stack" onSubmit={createRun}>
            <label>
              Market
              <select aria-label="Market" name="marketId" required>
                <option value="">Choose a market</option>
                {markets.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {[
              ['cutoffAt', 'Order cutoff'],
              ['startsAt', 'Market opens'],
              ['endsAt', 'Market closes'],
              ['deliveryStartAt', 'Delivery starts'],
              ['deliveryEndAt', 'Delivery ends'],
            ].map(([name, text]) => (
              <label key={name}>
                {text}
                <input type="datetime-local" required name={name} />
              </label>
            ))}
            <label>
              Delivery fee ($)
              <input
                name="fee"
                type="number"
                required
                min={0}
                max={1000}
                step="0.01"
                defaultValue="0"
              />
            </label>
            <button disabled={busy}>Schedule market day</button>
          </form>
        </Panel>
      </div>
      <SchedulingJobs />
      <RecurringSchedules />
      <Panel title="Market runs">
        {runs.isError && <ErrorState error={runs.error} />}
        <div className="run-cards">
          {runs.data?.map(({ run, market }) => (
            <article className="run-card" key={run.id}>
              <h3>{market.name}</h3>
              <span className="badge">{label(run.status)}</span>
              <p>{when(run.startsAt, market.timezone)}</p>
              <p>Cutoff {when(run.cutoffAt, market.timezone)}</p>
              <p>{run.driverId ? 'Driver assigned' : 'Awaiting a driver'}</p>
              <RunDriverAssignment run={run} />
              {run.status === 'scheduled' && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('Cancel this run and all its orders?'))
                      void act(
                        () => rpc.admin.cancelRun.mutate({ id: run.id }),
                        'Run cancelled',
                      );
                  }}
                >
                  Cancel run
                </button>
              )}
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}
function InventoryAdmin() {
  const runs = useQuery(api.admin.runs.queryOptions()),
    catalog = useQuery(api.produce.list.queryOptions({}));
  const { act, busy, notice } = useAction();
  const [runId, setRunId] = useState('');
  const inventory = useQuery(
    api.markets.inventory.queryOptions({ id: runId }, { enabled: !!runId }),
  );
  return (
    <>
      {notice}
      <div className="page-grid">
        <Panel title="Stock a market day">
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void act(
                () =>
                  rpc.admin.saveInventory.mutate({
                    runId,
                    produceId: value(form, 'produceId'),
                    quantity: Number(value(form, 'quantity')),
                    priceCents: Math.round(Number(value(form, 'price')) * 100),
                    active: value(form, 'active') === 'on',
                    repeat: value(form, 'repeat') === 'on',
                  }),
                'Inventory saved',
              );
            }}
          >
            <label>
              Market run
              <select
                aria-label="Inventory market run"
                required
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
                <option value="">Choose a market day</option>
                {runs.data
                  ?.filter((r) => r.run.status === 'scheduled')
                  .map(({ run, market }) => (
                    <option value={run.id} key={run.id}>
                      {market.name} · {when(run.startsAt, market.timezone)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Produce
              <select aria-label="Produce" name="produceId" required>
                {catalog.data?.map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name} / {i.unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Offered quantity
              <input
                name="quantity"
                required
                type="number"
                min={0}
                max={100000}
              />
            </label>
            <label>
              Unit price ($)
              <input
                name="price"
                type="number"
                required
                min={0}
                max={10000}
                step="0.01"
              />
            </label>
            <label className="checkbox-label">
              <input name="active" type="checkbox" defaultChecked /> Published
            </label>
            <label className="checkbox-label">
              <input name="repeat" type="checkbox" defaultChecked />
              Use these defaults for future dates on this schedule
            </label>
            <button disabled={busy}>Save inventory</button>
          </form>
          {inventory.data?.map((i) => (
            <p key={i.id}>
              {i.name}: {i.quantity} offered / {i.reservedQuantity} reserved /{' '}
              {i.availableQuantity} remaining
            </p>
          ))}
        </Panel>
        <Panel title="Add produce to the catalog">
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void act(async () => {
                await rpc.admin.createProduce.mutate({
                  name: value(form, 'name'),
                  description: value(form, 'description'),
                  category: value(form, 'category') as
                    'Vegetables' | 'Fruit' | 'Herbs',
                  unit: value(form, 'unit') as
                    'lb' | 'bunch' | 'basket' | 'each',
                  source: value(form, 'source'),
                  location: value(form, 'location'),
                });
                form.reset();
              }, 'Produce added to catalog');
            }}
          >
            <label>
              Produce name
              <input name="name" required minLength={2} maxLength={150} />
            </label>
            <label>
              Description
              <textarea name="description" maxLength={500} />
            </label>
            <label>
              Category
              <select aria-label="Category" name="category">
                {['Vegetables', 'Fruit', 'Herbs'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Sale unit
              <select aria-label="Sale unit" name="unit">
                {['lb', 'bunch', 'basket', 'each'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label>
              Source / vendor
              <input name="source" required minLength={2} maxLength={150} />
            </label>
            <label>
              Source location
              <input name="location" required minLength={2} maxLength={150} />
            </label>
            <button disabled={busy}>Add produce</button>
          </form>
        </Panel>
      </div>
    </>
  );
}
function PeopleAdmin() {
  const invites = useQuery(api.admin.invitations.queryOptions()),
    drivers = useQuery(api.admin.drivers.queryOptions());
  const { act, busy, notice } = useAction();
  const [link, setLink] = useState('');
  return (
    <>
      {notice}
      <Panel title="Invite a neighbor or driver">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void act(async () => {
              const result = await rpc.admin.invite.mutate({
                email: value(form, 'email'),
                role: value(form, 'role') as 'customer' | 'driver',
              });
              setLink(`${location.origin}/?invite=${result.token}`);
            }, 'Invitation created. Share the link with the intended person.');
          }}
        >
          <label>
            Invitation email
            <input type="email" name="email" required />
          </label>
          <label>
            Profile
            <select aria-label="Profile" name="role">
              <option value="customer">Customer</option>
              <option value="driver">Approved driver</option>
            </select>
          </label>
          <button disabled={busy}>Create invitation</button>
        </form>
        {link && (
          <label>
            Invitation link (shown once)
            <input
              aria-label="Invitation link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        <p className="muted">
          Links expire after 7 days and only work with the invited email. Driver
          invitations grant approved driver access.
        </p>
        {invites.data?.map((i) => (
          <div className="list-row" key={i.id}>
            <span>
              {i.email} · {i.role} ·{' '}
              {i.usedAt
                ? 'Accepted'
                : i.revokedAt
                  ? 'Revoked'
                  : new Date(i.expiresAt) < new Date()
                    ? 'Expired'
                    : 'Pending'}
            </span>
            {!i.usedAt && !i.revokedAt && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => rpc.admin.revokeInvite.mutate({ id: i.id }),
                    'Invitation revoked',
                  )
                }
              >
                Revoke invitation
              </button>
            )}
          </div>
        ))}
      </Panel>
      <Panel title="Driver access">
        {drivers.data?.map((d) => (
          <div className="list-row" key={d.profile.userId}>
            <span>
              {d.name} · {d.email} ·{' '}
              {d.profile.vehicle || 'Vehicle not entered'} ·{' '}
              <strong>{d.profile.status}</strong>
            </span>
            <button
              disabled={busy}
              className="secondary"
              onClick={() =>
                void act(
                  () =>
                    rpc.admin.reviewDriver.mutate({
                      userId: d.profile.userId,
                      status:
                        d.profile.status === 'approved'
                          ? 'suspended'
                          : 'approved',
                    }),
                  'Driver access updated',
                )
              }
            >
              {d.profile.status === 'approved'
                ? 'Suspend driver'
                : 'Approve driver'}
            </button>
          </div>
        ))}
      </Panel>
    </>
  );
}
function TokensAdmin() {
  const tokens = useQuery(api.admin.tokens.queryOptions());
  const { act, busy, notice } = useAction();
  const [token, setToken] = useState('');
  return (
    <Panel title="Authenticated market operations MCP">
      {notice}
      <p>
        Endpoint:{' '}
        <code>
          {import.meta.env.VITE_API_URL
            ? new URL('/mcp', import.meta.env.VITE_API_URL).href
            : 'http://127.0.0.1:3001/mcp'}
        </code>
      </p>
      <p>
        Connect a Streamable HTTP client with an Authorization: Bearer token
        header. Tokens can manage markets, market days, and inventory with your
        administrator privileges. They expire after 90 days.
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void act(async () => {
            const result = await rpc.admin.createToken.mutate({
              name: value(form, 'name'),
            });
            setToken(result.token);
          }, 'Token created. Save it securely; it is shown only once.');
        }}
      >
        <label>
          Token name
          <input name="name" required minLength={2} maxLength={100} />
        </label>
        <button disabled={busy}>Create MCP token</button>
      </form>
      {token && (
        <label>
          New MCP token
          <input
            aria-label="New MCP token"
            readOnly
            value={token}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      {tokens.data?.map((t) => (
        <div key={t.id} className="list-row">
          <span>
            {t.name} · …{t.lastFour} ·{' '}
            {t.revokedAt ? 'Revoked' : `Expires ${when(t.expiresAt)}`}
          </span>
          {!t.revokedAt && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => rpc.admin.revokeToken.mutate({ id: t.id }),
                  'Token revoked',
                )
              }
            >
              Revoke token
            </button>
          )}
        </div>
      ))}
    </Panel>
  );
}

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const clockText = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function RecurringSchedules() {
  const schedules = useQuery(api.admin.schedules.queryOptions()),
    markets = useQuery(api.markets.list.queryOptions());
  const [editing, setEditing] = useState<
    | Awaited<ReturnType<typeof rpc.admin.schedules.query>>[number]['schedule']
    | null
  >(null);
  const { act, busy, notice } = useAction();
  const minutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h! * 60 + m!;
  };
  return (
    <Panel title="Recurring weekly schedules">
      {notice}
      <p>
        Store a weekly schedule once. The daily scheduling job prepares four
        upcoming dates using the market’s timezone and default inventory.
        Changes apply to newly generated runs; existing dates and orders are
        preserved.
      </p>
      <div className="run-cards">
        {schedules.data?.map(({ schedule, market }) => (
          <article className="run-card" key={schedule.id}>
            <h3>{market.name}</h3>
            <p>
              {weekdays[schedule.weekday]} · {clockText(schedule.opensMinute)}–
              {clockText(schedule.closesMinute)} ({market.timezone})
            </p>
            <p>
              {schedule.active ? 'Enabled' : 'Paused'} · Cutoff{' '}
              {schedule.cutoffMinutes / 60} hours before opening
              {schedule.skipThanksgiving ? ' · Thanksgiving skipped' : ''}
            </p>
            <button className="secondary" onClick={() => setEditing(schedule)}>
              Edit schedule
            </button>
          </article>
        ))}
      </div>
      <h3>{editing ? 'Edit weekly schedule' : 'Add weekly schedule'}</h3>
      <form
        className="form-stack"
        key={editing?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void act(
            () =>
              rpc.admin.saveSchedule.mutate({
                marketId: value(form, 'marketId'),
                weekday: Number(value(form, 'weekday')),
                opensMinute: minutes(value(form, 'opens')),
                closesMinute: minutes(value(form, 'closes')),
                cutoffMinutes: Math.round(Number(value(form, 'cutoff')) * 60),
                deliveryDelayMinutes: Number(value(form, 'delay')),
                deliveryDurationMinutes: Number(value(form, 'duration')),
                deliveryFeeCents: Math.round(Number(value(form, 'fee')) * 100),
                skipThanksgiving: value(form, 'thanksgiving') === 'on',
                active: value(form, 'enabled') === 'on',
              }),
            'Weekly schedule saved',
          );
        }}
      >
        <label>
          Schedule market
          <select
            aria-label="Schedule market"
            name="marketId"
            required
            defaultValue={editing?.marketId ?? ''}
          >
            <option value="">Choose a market</option>
            {markets.data?.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Day of week
          <select
            aria-label="Day of week"
            name="weekday"
            defaultValue={editing?.weekday ?? 4}
          >
            {weekdays.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weekly opening time
          <input
            type="time"
            name="opens"
            required
            defaultValue={clockText(editing?.opensMinute ?? 900)}
          />
        </label>
        <label>
          Weekly closing time
          <input
            type="time"
            name="closes"
            required
            defaultValue={clockText(editing?.closesMinute ?? 1140)}
          />
        </label>
        <label>
          Cutoff hours before opening
          <input
            type="number"
            name="cutoff"
            min={0}
            max={168}
            step="0.5"
            required
            defaultValue={(editing?.cutoffMinutes ?? 720) / 60}
          />
        </label>
        <label>
          Delivery delay after opening (minutes)
          <input
            type="number"
            name="delay"
            min={0}
            max={1440}
            required
            defaultValue={editing?.deliveryDelayMinutes ?? 0}
          />
        </label>
        <label>
          Delivery duration (minutes)
          <input
            type="number"
            name="duration"
            min={1}
            max={1440}
            required
            defaultValue={editing?.deliveryDurationMinutes ?? 120}
          />
        </label>
        <label>
          Recurring delivery fee ($)
          <input
            type="number"
            name="fee"
            min={0}
            max={1000}
            step="0.01"
            required
            defaultValue={(editing?.deliveryFeeCents ?? 500) / 100}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="thanksgiving"
            defaultChecked={editing?.skipThanksgiving ?? false}
          />
          Skip Thanksgiving Thursday
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={editing?.active ?? true}
          />
          Generate upcoming dates
        </label>
        <div className="inline-actions">
          <button disabled={busy}>Save weekly schedule</button>
          {editing && (
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Add another schedule
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function SchedulingJobs() {
  const jobs = useQuery(
    api.admin.jobs.queryOptions(undefined, { refetchInterval: 30000 }),
  );
  const { act, busy, notice } = useAction();
  return (
    <Panel title="Scheduling jobs">
      {notice}
      <p>
        The daily job keeps four upcoming dates ready per active schedule. Run
        it now after adding a schedule or updating inventory defaults.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void act(
            () => rpc.admin.runSchedulingJob.mutate(),
            'Scheduling job finished',
          )
        }
      >
        Run scheduling job now
      </button>
      <div className="run-cards">
        {jobs.data?.map((job) => (
          <article className="run-card" key={job.id}>
            <strong>
              {job.name} · {job.status}
            </strong>
            <p>
              {when(job.startedAt)} · {job.source} · {job.runsCreated} runs
              created · {job.ordersCancelled} orders cancelled ·{' '}
              {job.runsClosed} runs closed
            </p>
            {job.error && <p>{job.error}</p>}
          </article>
        ))}
      </div>
      {jobs.isError && <ErrorState error={jobs.error} />}
    </Panel>
  );
}
