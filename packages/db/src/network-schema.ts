import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
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

export const networkIdColumn = () =>
  uuid('network_id')
    .notNull()
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
    index('network_memberships_user_network_idx').on(t.userId, t.networkId),
    check(
      'membership_role_valid',
      sql`${t.role} IN ('member', 'network_admin')`,
    ),
  ],
);
