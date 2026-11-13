import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { AvailableOrders } from './AvailableOrders';
import { TripWorkspace } from './Trip';
import { ErrorState, Loading, Panel, when } from './ui';

export function Driver() {
  const [runId, setRunId] = useState<string | undefined>();
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState('');
  const workspace = useQuery(
    api.driver.workspace.queryOptions(
      { runId },
      { refetchInterval: 15000, placeholderData: keepPreviousData },
    ),
  );
  const trip = workspace.data?.trip;
  useEffect(() => {
    if (!runId && trip && !workspace.isPlaceholderData && !workspace.isFetching)
      setRunId(trip.run.id);
  }, [runId, trip?.run.id, workspace.isPlaceholderData, workspace.isFetching]);
  return (
    <div className="workspace trip-workspace">
      {finding ? (
        <AvailableOrders
          onBack={() => setFinding(false)}
          onClaimed={(id, notice) => {
            setRunId(id);
            setFinding(false);
            setMessage(notice);
          }}
        />
      ) : workspace.isPending || (trip && runId && trip.run.id !== runId) ? (
        <Loading />
      ) : workspace.isError ? (
        <>
          <ErrorState error={workspace.error} />
          <button
            className="secondary"
            onClick={() => {
              setRunId(undefined);
              void workspace.refetch();
            }}
          >
            Reload my trip
          </button>
        </>
      ) : !trip ? (
        <>
          <div className="page-heading">
            <p className="eyebrow">SHOP LOCAL, DELIVER WITH CARE</p>
            <h1>Your trip</h1>
          </div>
          <Panel title="No active trip">
            <p>Find orders to start your next market trip.</p>
            <button onClick={() => setFinding(true)}>Find orders</button>
          </Panel>
        </>
      ) : (
        <>
          {message && (
            <p className="notice success" role="status">
              {message}
            </p>
          )}
          {(workspace.data!.trips.length > 1 ||
            (workspace.data!.trips.length > 0 &&
              !workspace.data!.trips.some(
                (item) => item.run.id === trip.run.id,
              ))) && (
            <label className="driver-market-filter">
              Your trips
              <select
                value={trip.run.id}
                onChange={(event) => {
                  setRunId(event.target.value);
                  setMessage('');
                }}
              >
                {!workspace.data!.trips.some(
                  (item) => item.run.id === trip.run.id,
                ) && (
                  <option value={trip.run.id}>
                    {trip.market.name} · completed
                  </option>
                )}
                {workspace.data!.trips.map((item) => (
                  <option value={item.run.id} key={item.run.id}>
                    {item.market.name} ·{' '}
                    {when(item.run.startsAt, item.market.timezone)} ·{' '}
                    {item.orderCount} orders
                  </option>
                ))}
              </select>
            </label>
          )}
          <TripWorkspace
            key={trip.run.id}
            trip={trip}
            onFindOrders={() => {
              setFinding(true);
              setMessage('');
            }}
            onReleased={() => {
              setRunId(undefined);
              setMessage('');
            }}
          />
        </>
      )}
    </div>
  );
}
