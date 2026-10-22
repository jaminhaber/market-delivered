import { createHash, randomBytes } from 'node:crypto';
import { createDatabase, invitations } from '../packages/db/src/index.js';
const email = process.argv[2]?.toLowerCase(),
  role = process.argv[3] ?? 'customer';
if (
  !email?.includes('@') ||
  !['customer', 'driver'].includes(role) ||
  !process.env.DATABASE_URL
)
  throw new Error(
    'Usage: npm run invite:create -- email@example.com [customer|driver]',
  );
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const token = randomBytes(32).toString('hex');
  await db.insert(invitations).values({
    email,
    role,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  console.log(
    `Invitation for ${email}: ${process.env.WEB_ORIGIN ?? 'http://localhost:5173'}/?invite=${token}`,
  );
} finally {
  await pool.end();
}
