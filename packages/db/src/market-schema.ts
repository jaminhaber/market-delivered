import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';
import { farms, produce } from './schema.js';
const created = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
// Store the entered address separately from the geocoder match; coordinates are approximate.
const deliveryAddressColumns = () => ({
  googlePlaceId: text('google_place_id'),
  street: text('street').notNull().default(''),
  unit: text('unit').notNull().default(''),
  city: text('city').notNull().default(''),
  region: text('region').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  country: text('country').notNull().default('US'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  geocodedAddress: text('geocoded_address'),
  geocodedAt: timestamp('geocoded_at', { withTimezone: true }),
  geocoder: text('geocoder'),
});
export const customerProfiles = pgTable('customer_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  ...deliveryAddressColumns(),
  deliveryNotes: text('delivery_notes').notNull().default(''),
});
export const driverStatus = pgEnum('driver_status', [
  'pending',
  'approved',
  'suspended',
]);
export const driverProfiles = pgTable('driver_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'restrict' }),
  phone: text('phone').notNull(),
  vehicle: text('vehicle').notNull(),
  status: driverStatus('status').notNull().default('pending'),
  createdAt: created(),
});
// Text roles permit new roles without changing users or an enum. Only trusted administration grants roles.
export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);
export const markets = pgTable('markets', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  createdAt: created(),
});
export const runStatus = pgEnum('run_status', [
  'scheduled',
  'shopping',
  'delivering',
  'completed',
  'cancelled',
]);
export const marketRuns = pgTable(
  'market_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    scheduleId: uuid('schedule_id').references(
      (): AnyPgColumn => marketSchedules.id,
    ),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),
    deliveryStartAt: timestamp('delivery_start_at', {
      withTimezone: true,
    }).notNull(),
    deliveryEndAt: timestamp('delivery_end_at', {
      withTimezone: true,
    }).notNull(),
    deliveryFeeCents: integer('delivery_fee_cents').notNull().default(0),
    status: runStatus('status').notNull().default('scheduled'),
    createdAt: created(),
  },
  (t) => [
    index('runs_schedule_idx').on(t.startsAt),
    check(
      'run_dates_valid',
      sql`${t.cutoffAt} <= ${t.startsAt} AND ${t.startsAt} < ${t.endsAt} AND ${t.deliveryStartAt} >= ${t.startsAt} AND ${t.deliveryEndAt} > ${t.deliveryStartAt}`,
    ),
    check('run_fee_nonnegative', sql`${t.deliveryFeeCents} >= 0`),
    uniqueIndex('run_market_start_unique').on(t.marketId, t.startsAt),
  ],
);
export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => marketRuns.id),
    produceId: uuid('produce_id')
      .notNull()
      .references(() => produce.id),
    priceCents: integer('price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('inventory_run_produce_unique').on(t.runId, t.produceId),
    check(
      'inventory_valid',
      sql`${t.quantity} >= 0 AND ${t.reservedQuantity} >= 0 AND ${t.reservedQuantity} <= ${t.quantity} AND ${t.priceCents} >= 0`,
    ),
  ],
);
export const orderStatus = pgEnum('order_status', [
  'placed',
  'claimed',
  'shopping',
  'ready',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'unavailable',
  'cancelled',
]);
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customerProfiles.userId),
    runId: uuid('run_id')
      .notNull()
      .references(() => marketRuns.id),
    requestId: uuid('request_id').notNull(),
    driverId: text('driver_id').references(() => driverProfiles.userId),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    status: orderStatus('status').notNull().default('placed'),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull(),
    ...deliveryAddressColumns(),
    deliveryNotes: text('delivery_notes').notNull(),
    deliveryFeeCents: integer('delivery_fee_cents').notNull(),
    estimatedTotalCents: integer('estimated_total_cents').notNull(),
    actualTotalCents: integer('actual_total_cents'),
    cashCollectedCents: integer('cash_collected_cents').notNull().default(0),
    cashRecordedAt: timestamp('cash_recorded_at', { withTimezone: true }),
    cashRecordedBy: text('cash_recorded_by').references(() => user.id),
    cashNote: text('cash_note').notNull().default(''),
    createdAt: created(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_customer_request_unique').on(t.customerId, t.requestId),
    index('orders_run_idx').on(t.runId),
    index('orders_driver_idx').on(t.driverId),
    check(
      'order_assignment_valid',
      sql`${t.status} NOT IN ('claimed', 'shopping', 'ready', 'out_for_delivery', 'delivery_failed', 'delivered') OR ${t.driverId} IS NOT NULL`,
    ),
    index('orders_customer_idx').on(t.customerId),
    check(
      'order_cash_valid',
      sql`${t.cashCollectedCents} >= 0 AND ${t.cashCollectedCents} <= coalesce(${t.actualTotalCents}, 0)`,
    ),
    check(
      'order_amounts_valid',
      sql`${t.deliveryFeeCents} >= 0 AND ${t.estimatedTotalCents} >= 0 AND (${t.actualTotalCents} IS NULL OR ${t.actualTotalCents} >= 0)`,
    ),
  ],
);
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventory.id),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    farmName: text('farm_name').notNull(),
    farmLocation: text('farm_location').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    quantity: integer('quantity').notNull(),
    priceCents: integer('price_cents').notNull(),
    fulfilledQuantity: integer('fulfilled_quantity'),
    actualCostCents: integer('actual_cost_cents'),
    packedAt: timestamp('packed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'packed_item_valid',
      sql`${t.packedAt} IS NULL OR (${t.fulfilledQuantity} IS NOT NULL AND ${t.fulfilledQuantity} > 0)`,
    ),
    uniqueIndex('order_inventory_unique').on(t.orderId, t.inventoryId),
    index('order_items_inventory_idx').on(t.inventoryId),
    check(
      'order_item_valid',
      sql`${t.quantity} > 0 AND ${t.priceCents} >= 0 AND (${t.fulfilledQuantity} IS NULL OR ${t.fulfilledQuantity} BETWEEN 0 AND ${t.quantity}) AND (${t.actualCostCents} IS NULL OR ${t.actualCostCents} >= 0)`,
    ),
  ],
);
export const purchases = pgTable(
  'purchases',
  {
    orderItemId: uuid('order_item_id')
      .primaryKey()
      .references(() => orderItems.id),
    quantity: integer('quantity').notNull(),
    totalCostCents: integer('total_cost_cents').notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      'purchase_valid',
      sql`${t.quantity} >= 0 AND ${t.totalCostCents} >= 0 AND (${t.quantity} > 0 OR ${t.totalCostCents} = 0)`,
    ),
  ],
);
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    // Null denotes an automated system transition.
    actorId: text('actor_id').references(() => user.id),
    status: orderStatus('status').notNull(),
    note: text('note').notNull().default(''),
    createdAt: created(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastFour: text('last_four').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: text('actor_id')
    .notNull()
    .references(() => user.id),
  action: text('action').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: created(),
});
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by').references(() => user.id),
    usedBy: text('used_by').references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index('invitations_email_idx').on(t.email),
    check('invitation_role_valid', sql`${t.role} IN ('customer','driver')`),
  ],
);

export const marketSchedules = pgTable(
  'market_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    weekday: integer('weekday').notNull(),
    opensMinute: integer('opens_minute').notNull(),
    closesMinute: integer('closes_minute').notNull(),
    cutoffMinutes: integer('cutoff_minutes').notNull().default(720),
    deliveryDelayMinutes: integer('delivery_delay_minutes')
      .notNull()
      .default(0),
    deliveryDurationMinutes: integer('delivery_duration_minutes')
      .notNull()
      .default(120),
    deliveryFeeCents: integer('delivery_fee_cents').notNull().default(500),
    skipThanksgiving: boolean('skip_thanksgiving').notNull().default(false),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('market_schedule_weekday_unique').on(t.marketId, t.weekday),
    check(
      'schedule_delivery_during_market',
      sql`${t.deliveryDelayMinutes} < ${t.closesMinute} - ${t.opensMinute}`,
    ),
    check(
      'market_schedule_valid',
      sql`${t.weekday} BETWEEN 0 AND 6 AND ${t.opensMinute} BETWEEN 0 AND 1439 AND ${t.closesMinute} > ${t.opensMinute} AND ${t.closesMinute} <= 1440 AND ${t.cutoffMinutes} BETWEEN 0 AND 10080 AND ${t.deliveryDelayMinutes} BETWEEN 0 AND 1440 AND ${t.deliveryDurationMinutes} BETWEEN 1 AND 1440 AND ${t.deliveryFeeCents} BETWEEN 0 AND 100000`,
    ),
  ],
);
export const scheduleInventory = pgTable(
  'schedule_inventory',
  {
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => marketSchedules.id),
    produceId: uuid('produce_id')
      .notNull()
      .references(() => produce.id),
    priceCents: integer('price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.produceId] }),
    check(
      'schedule_inventory_valid',
      sql`${t.priceCents} BETWEEN 0 AND 1000000 AND ${t.quantity} BETWEEN 0 AND 100000`,
    ),
  ],
);

export const backgroundJobRuns = pgTable(
  'background_job_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    schedulesProcessed: integer('schedules_processed').notNull().default(0),
    ordersCancelled: integer('orders_cancelled').notNull().default(0),
    runsClosed: integer('runs_closed').notNull().default(0),
    runsCreated: integer('runs_created').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    index('background_jobs_name_started_idx').on(t.name, t.startedAt),
    check(
      'background_jobs_status_valid',
      sql`${t.status} IN ('running','succeeded','failed','skipped')`,
    ),
  ],
);
