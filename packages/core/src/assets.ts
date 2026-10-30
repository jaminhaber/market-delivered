import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import { ensure, type Actor } from './operations.js';
import { checkRateLimit } from './rate-limit.js';

export type ImagesConfig = {
  accountId: string;
  apiToken: string;
  deliveryHash: string;
};
type Tx = Parameters<Parameters<s.Database['transaction']>[0]>[0];
const imageId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const assetMetadataInput = z
  .object({
    produce_id: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .optional(),
  })
  .catchall(z.json())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value)) <= 4096,
    'Metadata must be at most 4 KB',
  );
export const registerAssetInput = z.object({
  cloudflareImageId: imageId,
  altText: z.string().trim().max(500).default(''),
  metadata: assetMetadataInput.default({}),
  replaceAssetId: z
    .uuid()
    .optional()
    .describe(
      'Current produce image asset ID, required when replacing an image.',
    ),
});
export const listAssetsInput = z.object({
  produceId: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(1000000).default(0),
});
export const updateAssetInput = z.object({
  id: z.uuid(),
  altText: z.string().trim().max(500),
});

export function assetImage(
  config: ImagesConfig | undefined,
  asset: { id: string; cloudflareImageId: string; altText: string } | null,
) {
  if (!config || !asset) return null;
  const base = `https://imagedelivery.net/${encodeURIComponent(config.deliveryHash)}/${encodeURIComponent(asset.cloudflareImageId)}`;
  return {
    id: asset.id,
    altText: asset.altText,
    thumbnail: `${base}/thumbnail`,
    card: `${base}/produce-card`,
    detail: `${base}/produce-detail`,
  };
}

// JSONB associations always join on network ID as well as the produce ID.
export function produceAssetJoin(db: s.Database) {
  return s.networkWhere(
    db,
    s.assets,
    sql`${s.assets.metadata}->>'produce_id' = ${s.produce.id}::text`,
  );
}

export function assetImageSelect(config?: ImagesConfig) {
  const base = `https://imagedelivery.net/${encodeURIComponent(config?.deliveryHash ?? '')}/`;
  return sql<
    ReturnType<typeof assetImage>
  >`case when ${s.assets.id} is null or ${!config} then null else json_build_object(
    'id', ${s.assets.id}, 'altText', ${s.assets.altText},
    'thumbnail', ${base} || ${s.assets.cloudflareImageId} || '/thumbnail',
    'card', ${base} || ${s.assets.cloudflareImageId} || '/produce-card',
    'detail', ${base} || ${s.assets.cloudflareImageId} || '/produce-detail'
  ) end`;
}

export function assetOperations(
  db: s.Database,
  actor: Actor,
  config?: ImagesConfig,
) {
  function admin() {
    ensure(actor.admin, 'Administrator access required', 'FORBIDDEN');
  }
  function configured() {
    if (!config)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Image uploads are not configured.',
      });
    return config;
  }
  async function cloudflare(
    path: string,
    options: RequestInit = {},
    missingOK = false,
  ) {
    const settings = configured();
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(settings.accountId)}/images/${path}`,
        {
          ...options,
          headers: { Authorization: `Bearer ${settings.apiToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'Image storage is unavailable. Please retry.',
      });
    }
    if (missingOK && response.status === 404) return null;
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: unknown;
    } | null;
    if (!response.ok || !body?.success)
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'Image storage could not complete the request. Please retry.',
      });
    return body.result;
  }
  const present = (asset: typeof s.assets.$inferSelect) => ({
    ...asset,
    image: assetImage(config, asset),
  });
  async function audit(tx: Tx, action: string, targetId: string) {
    await tx
      .insert(s.auditEvents)
      .values(s.networkValues(tx, { actorId: actor.id, action, targetId }));
  }
  return {
    async createUpload() {
      admin();
      configured();
      await checkRateLimit(
        db,
        `image-upload:${s.requireNetworkId(db)}:${actor.id}`,
        30,
        60_000,
        'Too many image uploads. Please wait a minute and try again.',
      );
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const body = new FormData();
      body.set('expiry', expiresAt);
      body.set('requireSignedURLs', 'false');
      body.set(
        'metadata',
        JSON.stringify({
          network_id: s.requireNetworkId(db),
          uploaded_by: actor.id,
        }),
      );
      body.set('creator', actor.id);
      const result = z
        .object({
          id: imageId,
          uploadURL: z
            .url()
            .refine(
              (url) =>
                new URL(url).origin === 'https://upload.imagedelivery.net',
            ),
        })
        .parse(await cloudflare('v2/direct_upload', { method: 'POST', body }));
      return {
        cloudflareImageId: result.id,
        uploadUrl: result.uploadURL,
        expiresAt,
      };
    },
    async register(input: z.infer<typeof registerAssetInput>) {
      admin();
      const image = z
        .object({
          id: imageId,
          draft: z.boolean().optional(),
          uploaded: z.string().optional(),
          filename: z.string().max(255).default(''),
          requireSignedURLs: z.boolean().optional(),
          meta: z
            .object({ network_id: z.string(), uploaded_by: z.string() })
            .optional(),
          metadata: z
            .object({ network_id: z.string(), uploaded_by: z.string() })
            .optional(),
        })
        .parse(
          await cloudflare(`v1/${encodeURIComponent(input.cloudflareImageId)}`),
        );
      const ownership = image.meta ?? image.metadata;
      ensure(
        image.id === input.cloudflareImageId &&
          ownership?.network_id === s.requireNetworkId(db) &&
          ownership.uploaded_by === actor.id,
        'This image was not uploaded by you for this network.',
        'FORBIDDEN',
      );
      ensure(
        !image.draft && image.uploaded && !image.requireSignedURLs,
        'The public image upload has not completed.',
      );
      return db.transaction(async (tx) => {
        const produceId = input.metadata.produce_id;
        if (produceId) {
          const [produce] = await tx
            .select({ id: s.produce.id })
            .from(s.produce)
            .where(s.networkWhere(tx, s.produce, eq(s.produce.id, produceId)))
            .for('update');
          ensure(produce, 'Produce not found in this network', 'NOT_FOUND');
        }
        const [existing] = await tx
          .select()
          .from(s.assets)
          .where(
            s.networkWhere(
              tx,
              s.assets,
              eq(s.assets.cloudflareImageId, input.cloudflareImageId),
            ),
          );
        // A retry must not reattach a previously replaced image or overwrite edits.
        if (existing) return present(existing);
        if (produceId) {
          const [current] = await tx
            .select()
            .from(s.assets)
            .where(
              s.networkWhere(
                tx,
                s.assets,
                sql`${s.assets.metadata}->>'produce_id' = ${produceId}`,
              ),
            );
          ensure(
            current?.id === input.replaceAssetId,
            'The produce image changed. Refresh before replacing it.',
            'CONFLICT',
          );
          if (current) {
            await tx
              .update(s.assets)
              .set({ metadata: sql`${s.assets.metadata} - 'produce_id'` })
              .where(s.networkWhere(tx, s.assets, eq(s.assets.id, current.id)));
            await audit(tx, 'asset.detach', current.id);
          }
        }
        const [asset] = await tx
          .insert(s.assets)
          .values(
            s.networkValues(tx, {
              type: 'image',
              cloudflareImageId: image.id,
              filename: image.filename,
              altText: input.altText,
              metadata: input.metadata,
              createdBy: actor.id,
            }),
          )
          .onConflictDoNothing({ target: s.assets.cloudflareImageId })
          .returning();
        if (!asset) {
          // Roll back any replacement detach if another registration won the race.
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Image registration changed. Retry to read the existing asset.',
          });
        }
        await audit(tx, 'asset.register', asset.id);
        return present(asset);
      });
    },
    async list(input: z.infer<typeof listAssetsInput>) {
      admin();
      const rows = await db
        .select()
        .from(s.assets)
        .where(
          s.networkWhere(
            db,
            s.assets,
            input.produceId
              ? sql`${s.assets.metadata}->>'produce_id' = ${input.produceId.toLowerCase()}`
              : undefined,
          ),
        )
        .orderBy(desc(s.assets.createdAt), desc(s.assets.id))
        .limit(input.limit)
        .offset(input.offset);
      return rows.map(present);
    },
    async update(input: z.infer<typeof updateAssetInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [asset] = await tx
          .update(s.assets)
          .set({ altText: input.altText })
          .where(s.networkWhere(tx, s.assets, eq(s.assets.id, input.id)))
          .returning();
        ensure(asset, 'Asset not found', 'NOT_FOUND');
        await audit(tx, 'asset.update', asset.id);
        return present(asset);
      });
    },
    async delete(id: string) {
      admin();
      return db.transaction(async (tx) => {
        const [asset] = await tx
          .select()
          .from(s.assets)
          .where(s.networkWhere(tx, s.assets, eq(s.assets.id, id)))
          .for('update');
        ensure(asset, 'Asset not found', 'NOT_FOUND');
        await cloudflare(
          `v1/${encodeURIComponent(asset.cloudflareImageId)}`,
          { method: 'DELETE' },
          true,
        );
        await tx
          .delete(s.assets)
          .where(and(eq(s.assets.id, id), s.networkWhere(tx, s.assets)));
        await audit(tx, 'asset.delete', id);
        return { id };
      });
    },
  };
}
