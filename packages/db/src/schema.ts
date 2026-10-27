import { networkIdColumn } from './network-schema.js';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  unique,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
