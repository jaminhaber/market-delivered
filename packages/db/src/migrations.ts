import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index.js';

export async function runMigrations(db: Database, migrationsFolder: string) {
  await db.transaction(async (tx) => {
    // Lock before creating/reading Drizzle's ledger so cold starts and CLI runs
    // cannot apply the same migration concurrently. Works with transaction poolers.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('market-delivered:migrations'))`,
    );
    await migrate(tx, { migrationsFolder });
  });
}
