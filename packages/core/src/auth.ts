import { resolveNetwork, permissions } from './networks.js';
import { createEmailSender } from './email.js';
import { createHash } from 'node:crypto';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  invitations,
  customerProfiles,
  driverProfiles,
  networkMemberships,
} from '@market/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { webOrigins } from './origins.js';
import {
  account,
  rateLimit,
  session,
  user,
  verification,
  type Database,
} from '@market/db';
export type AuthConfig = {
  secret: string;
  baseURL: string;
  basePath?: string;
  webOrigin: string;
  resendKey?: string;
  emailFrom?: string;
  appName?: string;
  emailReplyTo?: string;
  production?: boolean;
  surface?: 'business' | 'admin';
  cookiePrefix?: string;
};
export function createAuth(db: Database, config: AuthConfig) {
  const sendEmail = createEmailSender(config);
  const appName = (config.appName || 'Market Delivered').replace(
    /[\r\n]/g,
    ' ',
  );
  return betterAuth({
    appName,
    secret: config.secret,
    advanced: {
      cookiePrefix: config.cookiePrefix || 'md-business',
      useSecureCookies: !!config.production,
    },
    baseURL: config.baseURL,
    basePath: config.basePath,
    trustedOrigins: webOrigins(config),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, rateLimit },
    }),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/reset-password') return;
        const token = ctx.body?.token || ctx.query?.token;
        if (typeof token !== 'string') return;
        const reset = await ctx.context.internalAdapter.findVerificationValue(
          `reset-password:${token}`,
        );
        return { context: { context: { passwordResetUserId: reset?.value } } };
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const result = ctx.context.returned as {
            token?: string | null;
            user?: { id: string; emailVerified: boolean };
          } | null;
          if (result?.token || !result?.user?.emailVerified) return;
          const person = await ctx.context.internalAdapter.findUserById(
            result.user.id,
          );
          if (!person?.emailVerified) return;
          const freshSession = await ctx.context.internalAdapter.createSession(
            person.id,
          );
          if (!freshSession)
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Unable to sign in after accepting invitation.',
            });
          await setSessionCookie(ctx, { session: freshSession, user: person });
          return ctx.json({ ...result, token: freshSession.token });
        }
        if (ctx.path !== '/reset-password') return;
        const result = ctx.context.returned;
        if (
          !result ||
          typeof result !== 'object' ||
          !('status' in result) ||
          result.status !== true
        )
          return;
        const userId = (
          ctx.context as typeof ctx.context & {
            passwordResetUserId?: string;
          }
        ).passwordResetUserId;
        if (!userId) return;
        const person = await ctx.context.internalAdapter.findUserById(userId);
        if (!person || (config.production && !person.emailVerified)) return;
        const freshSession =
          await ctx.context.internalAdapter.createSession(userId);
        if (!freshSession)
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'Unable to sign in after password reset.',
          });
        await setSessionCookie(ctx, { session: freshSession, user: person });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (
              config.surface === 'admin' &&
              !(await permissions(db, session.userId)).globalAdmin
            )
              throw new APIError('FORBIDDEN', {
                message: 'Global administrator access required.',
              });
            return { data: session };
          },
        },
      },
      user: {
        create: {
          before: async (person, context) => {
            const token = context?.headers?.get('x-invite-token') ?? '';
            const network = await resolveNetwork(
              db,
              context?.headers?.get('x-network-id') || undefined,
            );
            const [invite] = await db
              .select()
              .from(invitations)
              .where(
                and(
                  eq(
                    invitations.tokenHash,
                    createHash('sha256').update(token).digest('hex'),
                  ),
                  eq(invitations.networkId, network.id),
                  eq(invitations.email, person.email.toLowerCase()),
                  isNull(invitations.usedAt),
                  isNull(invitations.revokedAt),
                  gt(invitations.expiresAt, new Date()),
                ),
              );
            if (!invite)
              throw new APIError('FORBIDDEN', {
                message: 'A valid invitation matching your email is required.',
              });
            // A valid invitation is bound to this email and proves access to its link.
            return { data: { ...person, emailVerified: true } };
          },
          after: async (person, context) => {
            const token = context?.headers?.get('x-invite-token') ?? '';
            const network = await resolveNetwork(
              db,
              context?.headers?.get('x-network-id') || undefined,
            );
            await db.transaction(async (tx) => {
              const [invite] = await tx
                .update(invitations)
                .set({ usedAt: new Date(), usedBy: person.id })
                .where(
                  and(
                    eq(
                      invitations.tokenHash,
                      createHash('sha256').update(token).digest('hex'),
                    ),
                    eq(invitations.networkId, network.id),
                    eq(invitations.email, person.email.toLowerCase()),
                    isNull(invitations.usedAt),
                    isNull(invitations.revokedAt),
                    gt(invitations.expiresAt, new Date()),
                  ),
                )
                .returning();
              if (!invite)
                throw new APIError('FORBIDDEN', {
                  message: 'Invitation is no longer available.',
                });
              await tx.insert(networkMemberships).values({
                networkId: invite.networkId,
                userId: person.id,
                role:
                  invite.role === 'network_admin' ? 'network_admin' : 'member',
              });
              await tx
                .insert(customerProfiles)
                .values({ networkId: invite.networkId, userId: person.id });
              if (invite.role === 'driver')
                await tx.insert(driverProfiles).values({
                  networkId: invite.networkId,
                  userId: person.id,
                  phone: '',
                  vehicle: '',
                  status: 'approved',
                });
            });
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.surface === 'admin',
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: !!config.production,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendEmail(user.email, `Reset your ${appName} password`, url),
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: !!config.production,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail(user.email, `Verify your ${appName} email`, url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: process.env.NODE_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 5 },
        '/send-verification-email': { window: 60, max: 5 },
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
