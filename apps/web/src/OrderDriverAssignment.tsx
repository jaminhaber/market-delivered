import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { ErrorState, useAction } from './ui';

type Order = Awaited<ReturnType<typeof rpc.admin.orders.query>>[number];

export function OrderDriverAssignment({ order }: { order: Order }) {
  const drivers = useQuery(api.admin.drivers.queryOptions());
  const { act, busy, notice } = useAction();
  if (
    ![
      'placed',
      'claimed',
      'shopping',
      'ready',
      'out_for_delivery',
      'delivery_failed',
    ].includes(order.status)
  )
    return null;
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const driverId =
          String(new FormData(event.currentTarget).get('driverId') ?? '') ||
          null;
        void act(
          () => rpc.admin.assignDriver.mutate({ orderId: order.id, driverId }),
          'Driver assignment updated',
        );
      }}
    >
      {notice}
      <label>
        Assigned driver
        <select
          aria-label="Assigned driver"
          key={order.driverId ?? 'unassigned'}
          name="driverId"
          defaultValue={order.driverId ?? ''}
          required={!['placed', 'claimed'].includes(order.status)}
        >
          <option
            value=""
            disabled={!['placed', 'claimed'].includes(order.status)}
          >
            {['placed', 'claimed'].includes(order.status)
              ? 'Unassigned'
              : 'Choose a replacement'}
          </option>
          {drivers.data
            ?.filter(
              (d) =>
                d.profile.status === 'approved' ||
                d.profile.userId === order.driverId,
            )
            .map((d) => (
              <option
                key={d.profile.userId}
                value={d.profile.userId}
                disabled={
                  d.profile.status !== 'approved' ||
                  d.profile.phone.length < 7 ||
                  d.profile.vehicle.length < 2
                }
              >
                {d.name} ({d.profile.status})
              </option>
            ))}
        </select>
      </label>
      {!['placed', 'claimed'].includes(order.status) && (
        <small>
          Coordinate the handoff of groceries and cash with both drivers before
          reassigning.
        </small>
      )}
      <button className="secondary" disabled={busy || !drivers.data}>
        Save driver assignment
      </button>
      {drivers.isError && <ErrorState error={drivers.error} />}
    </form>
  );
}
