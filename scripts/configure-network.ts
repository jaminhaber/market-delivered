import { createDatabase, networks } from '@market/db';
import { eq, and, isNull } from 'drizzle-orm';
import { networkInput } from '@market/core/networks';
const [slug, frontendOrigin] = process.argv.slice(2);
if (!slug || !frontendOrigin || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: npm run network:configure -- slug https://business.example',
  );
const origin = networkInput.shape.frontendOrigin.parse(frontendOrigin);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [network] = await db
    .update(networks)
    .set({ frontendOrigin: origin })
    .where(and(eq(networks.slug, slug), isNull(networks.deletedAt)))
    .returning({
      id: networks.id,
      slug: networks.slug,
      frontendOrigin: networks.frontendOrigin,
    });
  if (!network) throw new Error('Network not found');
  console.log(JSON.stringify(network, null, 2));
} finally {
  await pool.end();
}
