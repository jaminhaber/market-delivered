import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// Zippopotam.us serves GeoNames ZIP centroids; only the operator's ZIP is sent.
// Keep this separate from Google-returned customer address data.
export async function lookupZipCoordinates(
  postalCode: string,
  request: typeof fetch = fetch,
) {
  const zip = z
    .string()
    .regex(/^\d{5}$/)
    .parse(postalCode);
  let response: Response;
  try {
    response = await request(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'ZIP code lookup is unavailable. Your settings were not saved; try again.',
    });
  }
  if (response.status === 404)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'No search center was found for that ZIP code. Check the ZIP and try again.',
    });
  if (!response.ok)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'ZIP code lookup is unavailable. Your settings were not saved; try again.',
    });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const parsed = z
    .object({
      'post code': z.literal(zip),
      'country abbreviation': z.literal('US'),
      places: z
        .array(
          z.object({
            latitude: z
              .string()
              .trim()
              .min(1)
              .transform(Number)
              .pipe(z.number().min(-90).max(90)),
            longitude: z
              .string()
              .trim()
              .min(1)
              .transform(Number)
              .pipe(z.number().min(-180).max(180)),
          }),
        )
        .min(1),
    })
    .safeParse(payload);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'ZIP code lookup returned an invalid search center. Your settings were not saved; try again.',
    });
  return parsed.data.places[0]!;
}
