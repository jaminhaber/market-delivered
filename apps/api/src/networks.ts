import { addressInput } from './addresses.js';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { and, eq, asc, sql, isNull } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import { ensure } from './operations.js';
import type { EmailConfig } from './email.js';

export const networkInput = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color')
  .nullable()
  .optional();
const logo = z
  .string()
  .max(300_000)
  .refine((value) => {
    if (
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an HTTPS image URL or upload a PNG, JPEG, or WebP logo')
  .nullable()
  .optional();
export const brandingInput = z.object({
  primaryColor: color.describe(
    'Primary button and navigation color, as #RRGGBB; null restores the default.',
  ),
  accentColor: color.describe(
    'Accent color, as #RRGGBB; null restores the default.',
  ),
  backgroundColor: color.describe(
    'Page background color, as #RRGGBB; null restores the default.',
  ),
  textColor: color.describe(
    'Page text color, as #RRGGBB; null restores the default.',
  ),
  font: z
    .enum(['default', 'modern', 'editorial', 'rounded'])
    .nullable()
    .optional()
    .describe(
      'Font preset: default (DM Sans/DM Serif), modern (Arial), editorial (Georgia), rounded (Trebuchet).',
    ),
  logoUrl: logo.describe(
    'HTTPS logo image URL or base64 PNG/JPEG/WebP data URL (maximum 300,000 characters). null removes the logo.',
  ),
  headerDisplay: z
    .enum(['logo', 'text', 'logo-text'])
    .nullable()
    .optional()
    .describe(
      'Header: logo, text (app name), or logo-text (logo + app name). Defaults to logo, falling back to the app name if no logo is configured.',
    ),
});
const optionalEmail = z.string().trim().email().max(254).nullable().optional();
export const locationInput = z.object({
  city: z.string().trim().min(1).max(100).nullable().optional(),
  region: addressInput.shape.region.nullable().optional(),
  postalCode: addressInput.shape.postalCode.nullable().optional(),
  timezone: z
    .string()
    .trim()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Enter a valid IANA timezone')
    .nullable()
    .optional(),
  autocompleteBias: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusMeters: z.number().int().min(1).max(50000),
    })
    .nullable()
    .optional(),
});
export const networkSettingsInput = z
  .object({
    supportEmail: optionalEmail.describe(
      'Public customer support email; null clears it.',
    ),
    supportPhone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+0-9(). -]+$/)
      .refine(
        (v) => (v.match(/\d/g) || []).length >= 7,
        'Enter a phone number with at least seven digits',
      )
      .nullable()
      .optional()
      .describe('Public support phone number; null clears it.'),
    contactUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Use an HTTPS contact link without credentials')
      .nullable()
      .optional(),
    location: locationInput
      .nullable()
      .optional()
      .describe(
        'US address and new-market timezone defaults, plus an optional Places search bias. Supplied fields merge; null clears all defaults. This does not restrict delivery eligibility.',
      ),
    emailReplyTo: optionalEmail.describe(
      'Reply-to address for app emails; defaults to supportEmail when unset.',
    ),
    name: z
      .string()
      .trim()
      .min(2)
      .max(150)
      .optional()
      .describe('App name shown in Configure and text headers.'),
    branding: brandingInput
      .nullable()
      .optional()
      .describe(
        'Branding settings shared by all pages. Supplied fields merge with saved values; null resets all branding.',
      ),
    emailFrom: z
      .string()
      .trim()
      .max(254)
      .refine(
        (v) => !v || /^[^\r\n<>]+@[^\s<>]+\.[^\s<>]+$/.test(v),
        'Enter a sender email address',
      )
      .nullable()
      .optional(),
    emailKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .optional()
      .describe(
        'Write-only Resend API key override, encrypted at rest. null restores the platform key. Responses only return hasEmailKey.',
      ),
  })
  .refine(
    (v) => Object.values(v).some((value) => value !== undefined),
    'Provide at least one setting',
  );
export const membershipInput = z.object({
  email: z.email().toLowerCase(),
  role: z.enum(['member', 'network_admin']),
});
export const publicNetworkColumns = {
  id: s.networks.id,
  name: s.networks.name,
  slug: s.networks.slug,
};
export const networkColumns = {
  ...publicNetworkColumns,
  branding: s.networks.branding,
  supportEmail: s.networks.supportEmail,
  supportPhone: s.networks.supportPhone,
  contactUrl: s.networks.contactUrl,
  location: s.networks.location,
  emailReplyTo: s.networks.emailReplyTo,
  emailFrom: s.networks.emailFrom,
  hasEmailKey: sql<boolean>`${s.networks.emailKeyEncrypted} IS NOT NULL`,
  createdAt: s.networks.createdAt,
};
export async function permissions(
  db: s.Database,
  userId: string,
  networkId: string,
) {
  const [global] = await db
    .select()
    .from(s.userRoles)
    .where(
      and(eq(s.userRoles.userId, userId), eq(s.userRoles.role, 'global_admin')),
    );
  const [membership] = await db
    .select()
    .from(s.networkMemberships)
    .where(
      and(
        eq(s.networkMemberships.userId, userId),
        eq(s.networkMemberships.networkId, networkId),
      ),
    );
  return {
    globalAdmin: !!global,
    networkAdmin: membership?.role === 'network_admin',
    member: !!membership,
  };
}
export async function resolveNetwork(db: s.Database, selector?: string) {
  const [network] = await db
    .select(networkColumns)
    .from(s.networks)
    .where(
      and(
        isNull(s.networks.deletedAt),
        selector
          ? /^[0-9a-f-]{36}$/i.test(selector)
            ? eq(s.networks.id, selector)
            : eq(s.networks.slug, selector)
          : undefined,
      ),
    )
    .orderBy(asc(s.networks.createdAt), asc(s.networks.id))
    .limit(1);
  ensure(network, 'Network not found', 'NOT_FOUND');
  return network;
}
function encrypt(secret: string, networkId: string, value: string) {
  ensure(
    secret.length >= 32,
    'Network credential encryption requires the server auth secret',
  );
  const iv = randomBytes(12),
    cipher = createCipheriv(
      'aes-256-gcm',
      createHash('sha256')
        .update('market-delivered:network-email:v1\0')
        .update(secret)
        .digest(),
      iv,
    );
  cipher.setAAD(Buffer.from(networkId));
  return Buffer.concat([
    iv,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
function decrypt(secret: string, networkId: string, value: string) {
  const data = Buffer.from(value, 'base64'),
    decipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256')
        .update('market-delivered:network-email:v1\0')
        .update(secret)
        .digest(),
      data.subarray(0, 12),
    );
  decipher.setAAD(Buffer.from(networkId));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    decipher.update(data.subarray(12, -16)),
    decipher.final(),
  ]).toString();
}
export async function networkEmailConfig(
  db: s.Database,
  networkId: string,
  defaults: EmailConfig & { secret: string },
): Promise<EmailConfig> {
  const [n] = await db
    .select()
    .from(s.networks)
    .where(eq(s.networks.id, networkId));
  ensure(n, 'Network not found', 'NOT_FOUND');
  return {
    production: defaults.production,
    appName: n.name,
    emailReplyTo: n.emailReplyTo || n.supportEmail || undefined,
    emailFrom: n.emailFrom || defaults.emailFrom,
    resendKey: n.emailKeyEncrypted
      ? decrypt(defaults.secret, networkId, n.emailKeyEncrypted)
      : defaults.resendKey,
  };
}
export function networkOperations(
  db: s.Database,
  actor: { id: string; globalAdmin?: boolean; networkAdmin?: boolean },
  networkId: string,
  secret: string,
) {
  function admin() {
    ensure(
      actor.globalAdmin || actor.networkAdmin,
      'Network administrator access required',
      'FORBIDDEN',
    );
  }
  function global() {
    ensure(
      actor.globalAdmin,
      'Global administrator access required',
      'FORBIDDEN',
    );
  }
  async function audit(tx: s.Database, action: string, targetId: string) {
    await tx
      .insert(s.auditEvents)
      .values({ networkId, actorId: actor.id, action, targetId });
  }
  return {
    async createGlobalToken(name: string) {
      global();
      return db.transaction(async (tx) => {
        const token = `md_${randomBytes(32).toString('hex')}`;
        const [saved] = await tx
          .insert(s.apiTokens)
          .values({
            networkId: null,
            userId: actor.id,
            name,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            lastFour: token.slice(-4),
            expiresAt: new Date(Date.now() + 90 * 86400000),
          })
          .returning({ id: s.apiTokens.id });
        await audit(
          tx as unknown as s.Database,
          'global_api_token.created',
          saved!.id,
        );
        return { token };
      });
    },
    async revokeGlobalToken(id: string) {
      global();
      return db.transaction(async (tx) => {
        const [saved] = await tx
          .update(s.apiTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(s.apiTokens.id, id),
              eq(s.apiTokens.userId, actor.id),
              sql`${s.apiTokens.networkId} IS NULL`,
            ),
          )
          .returning({ id: s.apiTokens.id });
        if (saved)
          await audit(
            tx as unknown as s.Database,
            'global_api_token.revoked',
            saved.id,
          );
        return { success: true };
      });
    },
    async list() {
      global();
      return db
        .select(networkColumns)
        .from(s.networks)
        .where(isNull(s.networks.deletedAt))
        .orderBy(asc(s.networks.name));
    },
    async create(input: z.infer<typeof networkInput>) {
      global();
      return db.transaction(async (tx) => {
        const [n] = await tx
          .insert(s.networks)
          .values(input)
          .returning(networkColumns);
        await tx.insert(s.auditEvents).values({
          networkId: n!.id,
          actorId: actor.id,
          action: 'network.created',
          targetId: n!.id,
        });
        return n!;
      });
    },
    async get() {
      admin();
      return resolveNetwork(db, networkId);
    },
    async update(input: z.infer<typeof networkSettingsInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [n] = await tx
          .update(s.networks)
          .set({
            ...(input.supportEmail !== undefined
              ? { supportEmail: input.supportEmail }
              : {}),
            ...(input.supportPhone !== undefined
              ? { supportPhone: input.supportPhone }
              : {}),
            ...(input.contactUrl !== undefined
              ? { contactUrl: input.contactUrl }
              : {}),
            ...(input.emailReplyTo !== undefined
              ? { emailReplyTo: input.emailReplyTo }
              : {}),
            ...(input.location !== undefined
              ? {
                  location:
                    input.location === null
                      ? {}
                      : sql`coalesce(${s.networks.location}, '{}'::jsonb) || ${JSON.stringify(input.location)}::jsonb`,
                }
              : {}),
            ...(input.branding !== undefined
              ? {
                  branding:
                    input.branding === null
                      ? {}
                      : sql`coalesce(${s.networks.branding}, '{}'::jsonb) || ${JSON.stringify(input.branding)}::jsonb`,
                }
              : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.emailFrom !== undefined
              ? { emailFrom: input.emailFrom || null }
              : {}),
            ...(input.emailKey !== undefined
              ? {
                  emailKeyEncrypted:
                    input.emailKey === null
                      ? null
                      : encrypt(secret, networkId, input.emailKey),
                }
              : {}),
          })
          .where(eq(s.networks.id, networkId))
          .returning(networkColumns);
        await audit(tx as unknown as s.Database, 'network.updated', networkId);
        return n!;
      });
    },
    async members() {
      admin();
      return db
        .select({
          userId: s.user.id,
          email: s.user.email,
          name: s.user.name,
          role: s.networkMemberships.role,
        })
        .from(s.networkMemberships)
        .innerJoin(s.user, eq(s.user.id, s.networkMemberships.userId))
        .where(eq(s.networkMemberships.networkId, networkId));
    },
    async setMember(input: z.infer<typeof membershipInput>) {
      admin();
      return db.transaction(async (tx) => {
        // Serialize membership changes so concurrent demotions cannot remove every admin.
        await tx.execute(
          sql`select id from networks where id = ${networkId} for update`,
        );
        const [person] = await tx
          .select()
          .from(s.user)
          .where(eq(s.user.email, input.email));
        ensure(
          person,
          'Invite this person to sign up before assigning membership',
          'NOT_FOUND',
        );
        const [existing] = await tx
          .select()
          .from(s.networkMemberships)
          .where(
            and(
              eq(s.networkMemberships.networkId, networkId),
              eq(s.networkMemberships.userId, person.id),
            ),
          );
        ensure(
          actor.globalAdmin || existing,
          'Network administrators can only manage existing network members',
          'FORBIDDEN',
        );
        if (existing?.role === 'network_admin' && input.role === 'member') {
          const admins = await tx
            .select()
            .from(s.networkMemberships)
            .where(
              and(
                eq(s.networkMemberships.networkId, networkId),
                eq(s.networkMemberships.role, 'network_admin'),
              ),
            );
          ensure(
            admins.length > 1 || actor.globalAdmin,
            'A network must retain an administrator',
            'CONFLICT',
          );
        }
        await tx
          .insert(s.networkMemberships)
          .values({ networkId, userId: person.id, role: input.role })
          .onConflictDoUpdate({
            target: [
              s.networkMemberships.networkId,
              s.networkMemberships.userId,
            ],
            set: { role: input.role },
          });
        await tx
          .insert(s.customerProfiles)
          .values({ networkId, userId: person.id })
          .onConflictDoNothing();
        await audit(
          tx as unknown as s.Database,
          'network.member_updated',
          person.id,
        );
        return { success: true };
      });
    },
  };
}
