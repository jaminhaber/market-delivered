import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { ErrorState, useAction } from './ui';

type Run = Awaited<ReturnType<typeof rpc.admin.runs.query>>[number]['run'];

export function RunDriverAssignment({ run }: { run: Run }) {
  const drivers = useQuery(api.admin.drivers.queryOptions());
  const { act, busy, notice } = useAction();
  if (!['scheduled', 'shopping', 'delivering'].includes(run.status))
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
          () => rpc.admin.assignDriver.mutate({ runId: run.id, driverId }),
          'Driver assignment updated',
        );
      }}
    >
      {notice}
      <label>
        Assigned driver
        <select
          aria-label="Assigned driver"
          key={run.driverId ?? 'unassigned'}
          name="driverId"
          defaultValue={run.driverId ?? ''}
          required={run.status !== 'scheduled'}
        >
          <option value="" disabled={run.status !== 'scheduled'}>
            {run.status === 'scheduled' ? 'Unassigned' : 'Choose a replacement'}
          </option>
          {drivers.data
            ?.filter(
              (d) =>
                d.profile.status === 'approved' ||
                d.profile.userId === run.driverId,
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
      {run.status !== 'scheduled' && (
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
