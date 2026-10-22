import { createDatabase, user, userRoles } from '../packages/db/src/index.js';
import { eq } from 'drizzle-orm';
const email = process.argv[2]?.toLowerCase();
if (!email || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: npm run admin:grant -- email@example.com (after signing up)',
  );
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [person] = await db.select().from(user).where(eq(user.email, email));
  if (!person) throw new Error('Sign up first. No matching account exists.');
  await db
    .insert(userRoles)
    .values({ userId: person.id, role: 'admin' })
    .onConflictDoNothing();
  console.log(
    `Administrator access granted to ${email}. Refresh your account.`,
  );
} finally {
  await pool.end();
}
