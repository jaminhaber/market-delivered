import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { account, user, userRoles, type Database } from '@market/db';

// Trusted CLI bootstrap only. Public signup still requires a network invitation.
export async function bootstrapGlobalAdmin(
  db: Database,
  email: string,
  password: string,
) {
  email = z.email().parse(email.trim().toLowerCase());
  z.string().min(12).max(128).parse(password);
  const hashed = await hashPassword(password);
  return db.transaction(async (tx) => {
    const id = randomUUID();
    await tx
      .insert(user)
      .values({ id, email, name: 'Global administrator', emailVerified: true });
    await tx.insert(account).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: hashed,
    });
    await tx.insert(userRoles).values({ userId: id, role: 'global_admin' });
    return { id, email };
  });
}
