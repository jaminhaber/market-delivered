import { networkValues } from './network-scope.js';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  networks,
  networkDatabase,
  farms,
  produce,
  markets,
  marketSchedules,
  scheduleInventory,
  runMarketRunsJob,
} from './index.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('Demo seeding is disabled in production.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const { db: rootDb, pool } = createDatabase(process.env.DATABASE_URL);
const slug = process.argv[2];
const [network] = slug
  ? await rootDb.select().from(networks).where(eq(networks.slug, slug))
  : [];
if (!network || network.deletedAt) {
  await pool.end();
  throw new Error(
    'Create a network first, then use npm run db:seed -- network-slug',
  );
}
const db = networkDatabase(rootDb, network.id, '');
function demoId(key: string) {
  const hex = createHash('sha256')
    .update(`${network!.id}:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const farmIds = [demoId('farm-1'), demoId('farm-2'), demoId('farm-3')] as const;
const items = [
  [
    'Heirloom tomatoes',
    'Sun-ripened, colorful, and full of summer flavor.',
    'Vegetables',
    'lb',
    450,
    24,
    0,
  ],
  [
    'Rainbow carrots',
    'A sweet, crunchy mix in purple, orange, and gold.',
    'Vegetables',
    'bunch',
    350,
    18,
    0,
  ],
  [
    'Lacinato kale',
    'Tender dark leaves for salads, soups, and sautés.',
    'Vegetables',
    'bunch',
    300,
    15,
    0,
  ],
  [
    'Summer squash',
    'Fresh-picked zucchini and golden squash.',
    'Vegetables',
    'lb',
    275,
    30,
    0,
  ],
  [
    'Honeycrisp apples',
    'Crisp, juicy apples with a bright, sweet finish.',
    'Fruit',
    'lb',
    325,
    40,
    1,
  ],
  [
    'Albion strawberries',
    'Fragrant berries, picked at their sweetest.',
    'Fruit',
    'basket',
    600,
    12,
    1,
  ],
  [
    'Yellow peaches',
    'Golden-fleshed peaches, perfect for eating fresh.',
    'Fruit',
    'lb',
    400,
    20,
    1,
  ],
  [
    'Fresh basil',
    'Aromatic green leaves for pesto and summer plates.',
    'Herbs',
    'bunch',
    250,
    16,
    2,
  ],
  [
    'Rosemary',
    'Woodsy, fragrant sprigs, freshly cut.',
    'Herbs',
    'bunch',
    200,
    10,
    2,
  ],
  [
    'Butter lettuce',
    'Soft, delicate leaves with a gentle crunch.',
    'Vegetables',
    'each',
    300,
    0,
    2,
  ],
  [
    'Sugar snap peas',
    'Sweet, crisp pods for snacking or a quick stir-fry.',
    'Vegetables',
    'lb',
    500,
    14,
    0,
  ],
  [
    'Fresh mint',
    'Bright, cooling leaves for tea, salads, and lemonade.',
    'Herbs',
    'bunch',
    200,
    8,
    2,
  ],
] as const;
try {
  await db.transaction(async (tx) => {
    await tx
      .insert(farms)
      .values(
        networkValues(tx, [
          { id: farmIds[0], name: 'Willow Creek Farm', location: 'Ojai, CA' },
          {
            id: farmIds[1],
            name: 'Sunstone Orchard',
            location: 'Ojai, CA',
          },
          {
            id: farmIds[2],
            name: 'Little Sprout Gardens',
            location: 'Ojai, CA',
          },
        ]),
      )
      .onConflictDoUpdate({ target: farms.id, set: { location: 'Ojai, CA' } });
    await tx
      .insert(produce)
      .values(
        networkValues(
          tx,
          items.map(
            (
              [
                name,
                description,
                category,
                unit,
                priceCents,
                availableQuantity,
                farm,
              ],
              i,
            ) => ({
              id: demoId(`produce-${i}`),
              farmId: farmIds[farm],
              name,
              description,
              category,
              unit,
              priceCents,
              availableQuantity,
            }),
          ),
        ),
      )
      .onConflictDoNothing();
  });
  await db.transaction(async (tx) => {
    // These are different operators and locations, not one market with two days.
    // Sources checked 2026-10-21:
    // https://www.ojaicommunityfarmersmarket.com/location
    // https://www.ojaicommunityfarmersmarket.com/faqs-1-1 (Thanksgiving closure)
    // https://www.ojairotie.com/journal/farmers-market
    const schedules = [
      {
        key: '000000000010',
        name: 'Ojai Community Farmers Market',
        address: '414 E. Ojai Avenue, Ojai, CA 93023',
        weekday: 4,
        opens: 15,
        closes: 19,
      },
      {
        key: '000000000011',
        name: 'Ojai Certified Farmers Market',
        address: '300 E. Matilija Street, Ojai, CA 93023',
        weekday: 0,
        opens: 9,
        closes: 13,
      },
    ];
    for (const schedule of schedules) {
      const marketId = demoId(`market-${schedule.key}`);
      const scheduleId = demoId(`schedule-${schedule.key}`);
      await tx
        .insert(markets)
        .values(
          networkValues(tx, {
            id: marketId,
            name: schedule.name,
            address: schedule.address,
            timezone: 'America/Los_Angeles',
          }),
        )
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            name: schedule.name,
            address: schedule.address,
            timezone: 'America/Los_Angeles',
          },
        });
      await tx
        .insert(marketSchedules)
        .values(
          networkValues(tx, {
            id: scheduleId,
            marketId,
            weekday: schedule.weekday,
            opensMinute: schedule.opens * 60,
            closesMinute: schedule.closes * 60,
            cutoffMinutes: 720,
            deliveryDurationMinutes: (schedule.closes - schedule.opens) * 60,
            deliveryFeeCents: 500,
            skipThanksgiving: schedule.weekday === 4,
          }),
        )
        .onConflictDoNothing();
      await tx
        .insert(scheduleInventory)
        .values(
          networkValues(
            tx,
            items.map((item, i) => ({
              scheduleId,
              produceId: demoId(`produce-${i}`),
              priceCents: item[4],
              quantity: item[5],
            })),
          ),
        )
        .onConflictDoNothing();
    }
  });
  await runMarketRunsJob(db, 'cli');
  console.log(
    'Ojai seed ready: 3 fictional source vendors, 12 produce items, and recurring Thursday/Sunday market schedules. Booked runs and existing inventory preserved.',
  );
} finally {
  await pool.end();
}
