import {
  createDatabase,
  user,
  userRoles,
  networkMemberships,
  networks,
} from '../packages/db/src/index.js';
import { eq, and, isNull } from 'drizzle-orm';
const email = process.argv[2]?.toLowerCase();
if (!email || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: npm run admin:grant -- email@example.com [global_admin|network_admin] [network-slug] (after signing up)',
  );
const role = process.argv[3] ?? 'global_admin';
if (!['global_admin', 'network_admin'].includes(role))
  throw new Error('Role must be global_admin or network_admin');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [person] = await db.select().from(user).where(eq(user.email, email));
  if (!person) throw new Error('Sign up first. No matching account exists.');
  if (role === 'global_admin')
    await db
      .insert(userRoles)
      .values({ userId: person.id, role })
      .onConflictDoNothing();
  else {
    if (!process.argv[4])
      throw new Error('A network slug is required for network_admin grants');
    const [network] = await db
      .select()
      .from(networks)
      .where(
        and(isNull(networks.deletedAt), eq(networks.slug, process.argv[4]!)),
      )
      .limit(1);
    if (!network) throw new Error('Network not found');
    await db
      .insert(networkMemberships)
      .values({ networkId: network.id, userId: person.id, role })
      .onConflictDoUpdate({
        target: [networkMemberships.networkId, networkMemberships.userId],
        set: { role },
      });
  }
  console.log(`${role} access granted to ${email}. Refresh your account.`);
} finally {
  await pool.end();
}
