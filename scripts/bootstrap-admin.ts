import { createDatabase } from '../packages/db/src/index.js';
import { bootstrapGlobalAdmin } from '../packages/core/src/bootstrap.js';
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
    `Global administrator created for ${email}. Sign in to Global administration for platform MCP access, or use npm run network:create to provision a business.`,
  );
} finally {
  await pool.end();
}
