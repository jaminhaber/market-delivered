import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ErrorState, Loading, Panel } from './ui';

const metrics = [
  ['members', 'Memberships'],
  ['vendors', 'Active vendors'],
  ['products', 'Products'],
  ['markets', 'Markets'],
  ['upcomingRuns', 'Upcoming runs'],
  ['orders', 'Orders'],
  ['delivered', 'Delivered orders'],
  ['orderValueCents', 'Order value'],
] as const;
const number = new Intl.NumberFormat('en-US');
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function NetworkStatistics() {
  const statistics = useQuery(api.networks.statistics.queryOptions());
  const networks = statistics.data;
  return (
    <div className="statistics">
      <div className="statistics-heading">
        <p className="muted">All-time activity across current networks.</p>
        <button
          className="secondary"
          disabled={statistics.isFetching}
          onClick={() => void statistics.refetch()}
        >
          {statistics.isFetching ? 'Refreshing…' : 'Refresh statistics'}
        </button>
      </div>
      {statistics.isPending && <Loading />}
      {statistics.error && <ErrorState error={statistics.error} />}
      {networks && (
        <>
          <dl className="stat-cards">
            <div>
              <dt>Networks</dt>
              <dd>{number.format(networks.length)}</dd>
            </div>
            {metrics.map(([key, label]) => {
              const total = networks.reduce(
                (sum, network) => sum + network[key],
                0,
              );
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {key === 'orderValueCents'
                      ? money.format(total / 100)
                      : number.format(total)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <Panel title="Statistics by network">
            <p className="muted">
              Memberships count each network membership separately. Order value
              includes delivery fees, uses actual totals when available and
              estimates otherwise, and excludes cancelled orders. It is not
              collected revenue.
            </p>
            {networks.length === 0 ? (
              <p className="muted">No networks yet.</p>
            ) : (
              <div
                className="statistics-table"
                role="region"
                aria-label="Network statistics"
                tabIndex={0}
              >
                <table>
                  <caption className="visually-hidden">
                    All-time statistics for each current network
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Network</th>
                      {metrics.map(([key, label]) => (
                        <th scope="col" key={key}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {networks.map((network) => (
                      <tr key={network.id}>
                        <th scope="row">
                          {network.name}
                          <small className="muted">{network.slug}</small>
                        </th>
                        {metrics.map(([key]) => (
                          <td key={key}>
                            {key === 'orderValueCents'
                              ? money.format(network[key] / 100)
                              : number.format(network[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
