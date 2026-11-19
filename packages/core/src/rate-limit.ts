import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { rateLimit, type Database } from '@market/db';

// A cheap, bounded budget runs before DB-backed authentication and CORS.
// A full map rejects new clients rather than evicting an active client's limit.
export function createRequestBudget() {
  const clients = new Map<string, { count: number; expiresAt: number }>();
  let total = { count: 0, expiresAt: 0 };
  return (ip: string, cost = 1) => {
    const now = Date.now();
    if (total.expiresAt <= now) total = { count: 0, expiresAt: now + 60_000 };
    let client = clients.get(ip);
    if (client && client.expiresAt <= now) {
      clients.delete(ip);
      client = undefined;
    }
    const retry = (expiresAt: number) =>
      Math.max(1, Math.ceil((expiresAt - now) / 1000));
    if (total.count + cost > 6000) return retry(total.expiresAt);
    if (client && client.count + cost > 300) return retry(client.expiresAt);
    if (!client) {
      if (clients.size >= 10_000) {
        for (const [key, value] of clients) {
          if (value.expiresAt <= now) clients.delete(key);
        }
        if (clients.size >= 10_000) return 60;
      }
      client = { count: 0, expiresAt: now + 60_000 };
      clients.set(ip, client);
    }
    client.count += cost;
    total.count += cost;
    return 0;
  };
}

// One persistent row per user and operation; atomic across serverless instances.
// Separate keys keep these budgets independent of Better Auth's IP limits.
export async function checkRateLimit(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
  message = 'Too many address requests. Please wait a minute and try again.',
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
      message,
    });
}
