import { createDatabase, networks } from '@market/db';
import { networkInput } from '@market/core/networks';
const [slug, name, frontendOrigin] = process.argv.slice(2);
if (!slug || !name || !frontendOrigin || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: npm run network:create -- slug "Business name" https://business.example',
  );
const input = networkInput.parse({ slug, name, frontendOrigin });
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [network] = await db.insert(networks).values(input).returning({
    id: networks.id,
    slug: networks.slug,
    frontendOrigin: networks.frontendOrigin,
  });
  console.log(JSON.stringify(network, null, 2));
  console.log(
    'Use this network ID in the business frontend server configuration.',
  );
} finally {
  await pool.end();
}
