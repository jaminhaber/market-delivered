import { createDatabase } from '../packages/db/src/index.js';
import { bootstrapGlobalAdmin } from '../apps/api/src/bootstrap.js';
const email = process.argv[2];
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!process.env.DATABASE_URL || !email || !password)
  throw new Error(
    'Set ADMIN_BOOTSTRAP_PASSWORD (12–128 characters) and DATABASE_URL, then run npm run admin:bootstrap -- email@example.com',
  );
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await bootstrapGlobalAdmin(db, email, password);
  console.log(
    `Global administrator created for ${email}. Sign in and open Global administration to create your first network.`,
  );
} finally {
  await pool.end();
}
