import type { FastifyInstance } from 'fastify';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { networkDatabase, type Database } from '@market/db';
import type { ImagesConfig } from './assets.js';
import { availableMarketRuns, marketInventory } from './catalog.js';
import { resolveNetwork } from './networks.js';

async function loadInventory(
  db: Database,
  networkId: string,
  images?: ImagesConfig,
) {
  const network = await resolveNetwork(db, networkId);
  const scoped = networkDatabase(db, network.id, '');
  const runs = await availableMarketRuns(scoped);
  const inventory = runs.length
    ? await marketInventory(
        scoped,
        runs.map((run) => run.id),
        images,
      )
    : [];
  return {
    runs: runs.map((run) => ({
      ...run,
      startsAt: run.startsAt.toISOString(),
      endsAt: run.endsAt.toISOString(),
      cutoffAt: run.cutoffAt.toISOString(),
      deliveryStartAt: run.deliveryStartAt.toISOString(),
      deliveryEndAt: run.deliveryEndAt.toISOString(),
    })),
    inventory: inventory.map(
      ({ quantity: _quantity, reservedQuantity: _reserved, ...item }) => item,
    ),
  };
}

export type PublicInventory = Awaited<ReturnType<typeof loadInventory>>;

export function registerPublicInventory(
  server: FastifyInstance,
  db: Database,
  images?: ImagesConfig,
) {
  // One entry per network, including all open dates: arbitrary query strings
  // cannot create new DB work. Share a pending refresh to prevent stampedes.
  const cache = new Map<
    string,
    { expiresAt: number; value: Promise<PublicInventory> }
  >();
  server.get<{ Params: { networkId: string } }>(
    '/api/public/networks/:networkId/inventory',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Access-Control-Allow-Origin', '*');
      const parsed = z.uuid().safeParse(request.params.networkId);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid network ID' });
      const networkId = parsed.data.toLowerCase();
      let entry = cache.get(networkId);
      if (!entry || entry.expiresAt <= Date.now()) {
        cache.delete(networkId);
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        entry = {
          expiresAt: Infinity,
          value: loadInventory(db, networkId, images),
        };
        cache.set(networkId, entry);
        const current = entry;
        current.value = current.value
          .then((value) => {
            current.expiresAt = Date.now() + 60_000;
            return value;
          })
          .catch((error: unknown) => {
            if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
              // Bound repeated probes without caching transient DB failures.
              current.expiresAt = Date.now() + 5_000;
            } else if (cache.get(networkId) === current) cache.delete(networkId);
            throw error;
          });
      }
      const value = await entry.value;
      reply.header(
        'Cache-Control',
        'public, max-age=0, s-maxage=60, stale-while-revalidate=60',
      );
      // Preserve the CDN policy through the API CDN and storefront proxy.
      reply.header(
        'CDN-Cache-Control',
        'public, max-age=60, stale-while-revalidate=60',
      );
      reply.header(
        'Age',
        Math.floor((Date.now() - (entry.expiresAt - 60_000)) / 1000),
      );
      return value;
    },
  );
}
