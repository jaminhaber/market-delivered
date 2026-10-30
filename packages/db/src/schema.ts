import { networkIdColumn } from './network-schema.js';
import { sql } from 'drizzle-orm';
import { user } from './auth-schema.js';
import {
  boolean,
  check,
  foreignKey,
  unique,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    networkId: networkIdColumn(),
    type: text('type').notNull().default('image'),
    cloudflareImageId: text('cloudflare_image_id').notNull().unique(),
    filename: text('filename').notNull(),
    altText: text('alt_text').notNull().default(''),
    metadata: jsonb('metadata')
      .$type<{ produce_id?: string; [key: string]: unknown }>()
      .notNull()
      .default({}),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('assets_network_created_idx').on(t.networkId, t.createdAt),
    uniqueIndex('assets_network_produce_unique')
      .on(t.networkId, sql`(${t.metadata}->>'produce_id')`)
      .where(sql`${t.metadata} ? 'produce_id'`),
    check('assets_image_type', sql`${t.type} = 'image'`),
    check(
      'assets_metadata_object',
      sql`jsonb_typeof(${t.metadata}) = 'object'`,
    ),
  ],
);

export const produceCategory = pgEnum('produce_category', [
  'Vegetables',
  'Fruit',
  'Herbs',
]);
export const produceUnit = pgEnum('produce_unit', [
  'lb',
  'bunch',
  'basket',
  'each',
]);

export const farms = pgTable(
  'farms',
  {
    networkId: networkIdColumn(),
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    location: text('location').notNull(),
    contactPhone: text('contact_phone').notNull().default(''),
    notes: text('notes').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique('farms_network_identity').on(t.networkId, t.id)],
);

// One listing belongs to one farm. Store money in integer cents, never floats.
export const produce = pgTable(
  'produce',
  {
    networkId: networkIdColumn(),
    id: uuid('id').defaultRandom().primaryKey(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: produceCategory('category').notNull(),
    unit: produceUnit('unit').notNull(),
    priceCents: integer('price_cents').notNull(),
    availableQuantity: integer('available_quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('produce_network_identity').on(table.networkId, table.id),
    index('produce_network_farm_idx').on(table.networkId, table.farmId),
    foreignKey({
      name: 'produce_farm_id_network_fk',
      columns: [table.networkId, table.farmId],
      foreignColumns: [farms.networkId, farms.id],
    }),
    index('produce_farm_idx').on(table.farmId),
    index('produce_category_idx').on(table.category),
    check('produce_price_nonnegative', sql`${table.priceCents} >= 0`),
    check('produce_quantity_nonnegative', sql`${table.availableQuantity} >= 0`),
  ],
);
