import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from './index.js';

// Scope lives in application memory and follows transactions/savepoints. Queries
// explicitly use networkWhere/networkValues; no database roles or session state.
const scopes = new WeakMap<object, string>();
export const databaseNetworkId = (db: object) => scopes.get(db);
export function requireNetworkId(db: object) {
  const id = databaseNetworkId(db);
  if (!id) throw new Error('A network-scoped database is required');
  return id;
}

export function networkWhere(
  db: object,
  table: { networkId: AnyPgColumn },
  condition?: SQL,
) {
  return and(condition, eq(table.networkId, requireNetworkId(db)));
}

export function networkValues<T extends object>(
  db: object,
  values: T[],
): (T & { networkId: string })[];
export function networkValues<T extends object>(
  db: object,
  values: T,
): T & { networkId: string };
export function networkValues(db: object, values: object | object[]) {
  const networkId = requireNetworkId(db);
  function owned(value: object) {
    if (
      'networkId' in value &&
      value.networkId !== undefined &&
      value.networkId !== networkId
    )
      throw new Error('Cannot write data belonging to another network');
    return { ...value, networkId };
  }
  return Array.isArray(values) ? values.map(owned) : owned(values);
}

export function networkDatabase(
  db: Database,
  networkId: string,
  _userId: string,
): Database {
  if (!networkId) throw new Error('A network ID is required');
  const scoped = new Proxy(db, {
    get(target, property) {
      if (property === 'transaction')
        return (
          action: (tx: Database) => Promise<unknown>,
          config?: Parameters<Database['transaction']>[1],
        ) =>
          target.transaction(
            (tx) =>
              action(
                networkDatabase(tx as unknown as Database, networkId, _userId),
              ),
            config,
          );
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  scopes.set(scoped, networkId);
  return scoped;
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
