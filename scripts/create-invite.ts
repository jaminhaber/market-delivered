import { eq, and, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import {
  createDatabase,
  invitations,
  networks,
} from '../packages/db/src/index.js';
const email = process.argv[2]?.toLowerCase(),
  role = process.argv[3] ?? 'customer';
if (
  !email?.includes('@') ||
  !['customer', 'driver', 'network_admin'].includes(role) ||
  !process.env.DATABASE_URL ||
  !process.argv[4]
)
  throw new Error(
    'Usage: npm run invite:create -- email@example.com [customer|driver|network_admin] network-slug',
  );
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [network] = await db
    .select()
    .from(networks)
    .where(and(isNull(networks.deletedAt), eq(networks.slug, process.argv[4]!)))
    .limit(1);
  if (!network)
    throw new Error(
      `Network ${process.argv[4]} not found. Create it through the admin API or npm run network:create.`,
    );
  if (!network.frontendOrigin)
    throw new Error(
      'Configure the network frontend origin before creating invitations.',
    );
  const token = randomBytes(32).toString('hex');
  await db.insert(invitations).values({
    networkId: network.id,
    email,
    role,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  console.log(
    `Invitation for ${email}: ${network.frontendOrigin}/account?invite=${token}`,
  );
} finally {
  await pool.end();
}
