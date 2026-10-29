import { initTRPC, TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import {
  networkOperations,
  networkInput,
  networkSettingsInput,
  membershipInput,
} from './networks.js';
import type { Actor } from './operations.js';

export type AdminContext = {
  db: s.Database;
  actor: Actor | null;
  secret: string;
  production?: boolean;
};
const t = initTRPC.context<AdminContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        error.code === 'INTERNAL_SERVER_ERROR'
          ? 'Unable to complete the request.'
          : shape.message,
      data: { ...shape.data, stack: undefined },
    };
  },
});
const globalAdmin = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor)
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in' });
  if (!ctx.actor.globalAdmin)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Global administrator access required',
    });
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});
const id = z.object({ id: z.uuid() });
function ops(
  ctx: AdminContext & { actor: Actor },
  networkId: string | null = null,
) {
  return networkOperations(ctx.db, ctx.actor, networkId, ctx.secret);
}
function checkOrigin(ctx: AdminContext, origin?: string) {
  if (ctx.production && origin && new URL(origin).protocol !== 'https:')
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Production frontends require HTTPS',
    });
}
export const adminRouter = t.router({
  me: t.procedure.query(({ ctx }) =>
    ctx.actor
      ? {
          id: ctx.actor.id,
          name: ctx.actor.name,
          email: ctx.actor.email,
          globalAdmin: !!ctx.actor.globalAdmin,
        }
      : null,
  ),
  networks: t.router({
    statistics: globalAdmin.query(({ ctx }) =>
      ctx.db
        .select({
          id: s.networks.id,
          name: s.networks.name,
          slug: s.networks.slug,
          members:
            sql`(select count(*) from ${s.networkMemberships} where ${s.networkMemberships.networkId} = "networks"."id")`.mapWith(
              Number,
            ),
          vendors:
            sql`(select count(*) from ${s.farms} where ${s.farms.networkId} = "networks"."id" and ${s.farms.active})`.mapWith(
              Number,
            ),
          products:
            sql`(select count(*) from ${s.produce} where ${s.produce.networkId} = "networks"."id")`.mapWith(
              Number,
            ),
          markets:
            sql`(select count(*) from ${s.markets} where ${s.markets.networkId} = "networks"."id")`.mapWith(
              Number,
            ),
          upcomingRuns:
            sql`(select count(*) from ${s.marketRuns} where ${s.marketRuns.networkId} = "networks"."id" and ${s.marketRuns.status} = 'scheduled' and ${s.marketRuns.startsAt} > now())`.mapWith(
              Number,
            ),
          orders:
            sql`(select count(*) from ${s.orders} where ${s.orders.networkId} = "networks"."id")`.mapWith(
              Number,
            ),
          delivered:
            sql`(select count(*) from ${s.orders} where ${s.orders.networkId} = "networks"."id" and ${s.orders.status} = 'delivered')`.mapWith(
              Number,
            ),
          orderValueCents:
            sql`(select coalesce(sum(coalesce(${s.orders.actualTotalCents}, ${s.orders.estimatedTotalCents})), 0) from ${s.orders} where ${s.orders.networkId} = "networks"."id" and ${s.orders.status} != 'cancelled')`.mapWith(
              Number,
            ),
        })
        .from(s.networks)
        .where(isNull(s.networks.deletedAt))
        .orderBy(s.networks.name, s.networks.id),
    ),
    list: globalAdmin.query(({ ctx }) => ops(ctx).list()),
    create: globalAdmin.input(networkInput).mutation(({ ctx, input }) => {
      checkOrigin(ctx, input.frontendOrigin);
      return ops(ctx).create(input);
    }),
    get: globalAdmin
      .input(id)
      .query(({ ctx, input }) => ops(ctx, input.id).get()),
    update: globalAdmin
      .input(z.object({ networkId: z.uuid(), settings: networkSettingsInput }))
      .mutation(({ ctx, input }) => {
        checkOrigin(ctx, input.settings.frontendOrigin);
        return ops(ctx, input.networkId).update(input.settings);
      }),
    members: globalAdmin
      .input(id)
      .query(({ ctx, input }) => ops(ctx, input.id).members()),
    setMember: globalAdmin
      .input(z.object({ networkId: z.uuid(), ...membershipInput.shape }))
      .mutation(({ ctx, input }) => ops(ctx, input.networkId).setMember(input)),
  }),
  tokens: t.router({
    list: globalAdmin.query(({ ctx }) =>
      ctx.db
        .select({
          id: s.apiTokens.id,
          name: s.apiTokens.name,
          lastFour: s.apiTokens.lastFour,
          expiresAt: s.apiTokens.expiresAt,
          revokedAt: s.apiTokens.revokedAt,
        })
        .from(s.apiTokens)
        .where(
          and(
            eq(s.apiTokens.userId, ctx.actor.id),
            isNull(s.apiTokens.networkId),
          ),
        ),
    ),
    create: globalAdmin
      .input(z.object({ name: z.string().trim().min(2).max(100) }))
      .mutation(({ ctx, input }) => ops(ctx).createGlobalToken(input.name)),
    revoke: globalAdmin
      .input(id)
      .mutation(({ ctx, input }) => ops(ctx).revokeGlobalToken(input.id)),
  }),
});
export type AdminRouter = typeof adminRouter;
