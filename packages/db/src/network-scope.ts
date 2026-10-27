import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Database } from './index.js';
import * as catalog from './schema.js';
import * as auth from './auth-schema.js';
import * as market from './market-schema.js';
import * as network from './network-schema.js';

// A scoped database borrows the existing pool. Each standalone query runs in a
// short transaction; explicit domain transactions retain one scoped connection.
// This preserves independent failure logs/rate limits without a request-wide tx.
export function networkDatabase(
  db: Database,
  networkId: string,
  userId: string,
): Database {
  const pool = db.$client;
  async function scope(client: pg.PoolClient) {
    await client.query(
      "select set_config('app.network_id', $1, true), set_config('app.user_id', $2, true)",
      [networkId, userId],
    );
    await client.query('set local role market_network');
  }
  const scopedPool = new Proxy(pool, {
    get(target, property) {
      if (property === 'query')
        return async (...args: Parameters<pg.PoolClient['query']>) => {
          const client = await target.connect();
          try {
            await client.query('begin');
            await scope(client);
            const result = await client.query(...args);
            await client.query('commit');
            return result;
          } catch (error) {
            await client.query('rollback');
            throw error;
          } finally {
            client.release();
          }
        };
      if (property === 'connect')
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(connection, key) {
              if (key === 'query')
                return async (...args: Parameters<pg.PoolClient['query']>) => {
                  const query = args[0] as unknown as string | { text: string };
                  const text = typeof query === 'string' ? query : query.text;
                  const result = await connection.query(...args);
                  if (/^begin\b/i.test(text)) {
                    try {
                      await scope(connection);
                    } catch (error) {
                      await connection.query('rollback');
                      connection.release(true);
                      throw error;
                    }
                  }
                  return result;
                };
              const value = Reflect.get(connection, key);
              return typeof value === 'function'
                ? value.bind(connection)
                : value;
            },
          });
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return drizzle(scopedPool, {
    schema: { ...catalog, ...auth, ...market, ...network },
  });
}
export async function withNetwork<T>(
  db: Database,
  networkId: string,
  userId: string,
  action: (db: Database) => Promise<T>,
): Promise<T> {
  return networkDatabase(db, networkId, userId).transaction((tx) =>
    action(tx as unknown as Database),
  );
}
