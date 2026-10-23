import { fileURLToPath } from 'node:url';
import { createDatabase, runMigrations } from './index.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await runMigrations(
    db,
    fileURLToPath(new URL('../drizzle', import.meta.url)),
  );
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
