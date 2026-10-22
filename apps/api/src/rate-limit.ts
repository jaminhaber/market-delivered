import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { rateLimit, type Database } from '@market/db';

// One persistent row per user and operation; atomic across serverless instances.
// Separate keys keep these budgets independent of Better Auth's IP limits.
export async function checkRateLimit(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
) {
  const now = Date.now();
  const expired = sql`${rateLimit.lastRequest} <= ${now - windowMs}`;
  const [allowed] = await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${expired} THEN ${now} ELSE ${rateLimit.lastRequest} END`,
      },
      setWhere: sql`${expired} OR ${rateLimit.count} < ${max}`,
    })
    .returning({ id: rateLimit.id });
  if (!allowed)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many address requests. Please wait a minute and try again.',
    });
}
