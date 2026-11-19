import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as s from '@market/db';
import {
  assetImageSelect,
  produceAssetJoin,
  type ImagesConfig,
} from './assets.js';

export function availableMarketRuns(db: s.Database) {
  return db
    .select({
      id: s.marketRuns.id,
      marketId: s.marketRuns.marketId,
      marketName: s.markets.name,
      marketAddress: s.markets.address,
      timezone: s.markets.timezone,
      startsAt: s.marketRuns.startsAt,
      endsAt: s.marketRuns.endsAt,
      cutoffAt: s.marketRuns.cutoffAt,
      deliveryStartAt: s.marketRuns.deliveryStartAt,
      deliveryEndAt: s.marketRuns.deliveryEndAt,
      deliveryFeeCents: s.marketRuns.deliveryFeeCents,
      status: s.marketRuns.status,
    })
    .from(s.marketRuns)
    .innerJoin(
      s.markets,
      s.networkWhere(db, s.markets, eq(s.marketRuns.marketId, s.markets.id)),
    )
    .where(
      s.networkWhere(
        db,
        s.marketRuns,
        sql`${s.marketRuns.cutoffAt} > now() AND ${s.marketRuns.startsAt} <= now() + interval '14 days' AND ${s.marketRuns.status} = 'scheduled'`,
      ),
    )
    .orderBy(asc(s.marketRuns.startsAt))
    .limit(100);
}

export function marketInventory(
  db: s.Database,
  runIds: string[],
  images?: ImagesConfig,
) {
  return db
    .select({
      id: s.inventory.id,
      runId: s.inventory.runId,
      produceId: s.produce.id,
      image: assetImageSelect(images),
      name: s.produce.name,
      description: s.produce.description,
      category: s.produce.category,
      unit: s.produce.unit,
      priceCents: s.inventory.priceCents,
      quantity: s.inventory.quantity,
      reservedQuantity: s.inventory.reservedQuantity,
      availableQuantity: sql<number>`${s.inventory.quantity} - ${s.inventory.reservedQuantity}`,
      active: s.inventory.active,
      source: s.farms.name,
    })
    .from(s.inventory)
    .innerJoin(
      s.produce,
      s.networkWhere(db, s.produce, eq(s.produce.id, s.inventory.produceId)),
    )
    .innerJoin(
      s.farms,
      s.networkWhere(db, s.farms, eq(s.farms.id, s.produce.farmId)),
    )
    .leftJoin(s.assets, produceAssetJoin(db))
    .where(
      s.networkWhere(
        db,
        s.inventory,
        and(
          inArray(s.inventory.runId, runIds),
          eq(s.inventory.active, true),
          eq(s.farms.active, true),
        ),
      ),
    )
    .orderBy(asc(s.produce.name));
}
