import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  check,
  jsonb,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

export type NetworkBranding = {
  primaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  font?: 'default' | 'modern' | 'editorial' | 'rounded' | null;
  logoUrl?: string | null;
  headerDisplay?: 'logo' | 'text' | 'logo-text' | null;
};

export type NetworkLocation = {
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  timezone?: string | null;
  autocompleteBias?: {
    postalCode?: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  } | null;
};

export const OJAI_NETWORK_ID = '00000000-0000-4000-8000-000000000001';
// Trusted jobs/CLI default to Ojai. Request transactions always set an explicit network.
export const networkIdColumn = () =>
  uuid('network_id')
    .notNull()
    .default(
      sql`coalesce(nullif(current_setting('app.network_id', true), '')::uuid, '${sql.raw(OJAI_NETWORK_ID)}'::uuid)`,
    )
    .references(() => networks.id);
export const networks = pgTable('networks', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  branding: jsonb('branding').$type<NetworkBranding>().notNull().default({}),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  supportEmail: text('support_email'),
  supportPhone: text('support_phone'),
  contactUrl: text('contact_url'),
  location: jsonb('location').$type<NetworkLocation>().notNull().default({}),
  emailReplyTo: text('email_reply_to'),
  emailFrom: text('email_from'),
  emailKeyEncrypted: text('email_key_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const networkMemberships = pgTable(
  'network_memberships',
  {
    networkId: networkIdColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
  },
  (t) => [
    primaryKey({ columns: [t.networkId, t.userId] }),
    check(
      'membership_role_valid',
      sql`${t.role} IN ('member', 'network_admin')`,
    ),
  ],
);
