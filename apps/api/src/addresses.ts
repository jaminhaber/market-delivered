import type { NetworkLocation } from '@market/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

const states = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  ),
);
export const addressInput = z.object({
  street: z.string().trim().min(3).max(200),
  unit: z.string().trim().max(100).default(''),
  city: z.string().trim().min(1).max(100),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => states.has(value), 'Choose a valid US state'),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  country: z.literal('US').default('US'),
});
type Address = z.infer<typeof addressInput>;
export function formatAddress(address: Address) {
  return [
    address.street,
    address.unit,
    address.city,
    `${address.region} ${address.postalCode}`,
    address.country,
  ]
    .filter(Boolean)
    .join(', ');
}
export async function geocodeAddress(
  address: Address,
  apiKey: string | undefined,
  request: typeof fetch = fetch,
) {
  if (!apiKey)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Address lookup has not been configured.',
    });
  let payload: unknown;
  let status: number;
  try {
    const response = await request(
      'https://addressvalidation.googleapis.com/v1:validateAddress',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          address: {
            regionCode: address.country,
            locality: address.city,
            administrativeArea: address.region,
            postalCode: address.postalCode,
            addressLines: [address.street, address.unit].filter(Boolean),
          },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    status = response.status;
    payload = await response.json();
  } catch {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'Address lookup is unavailable. Your saved address is unchanged; try again later.',
    });
  }
  if (status === 401 || status === 403)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Google Address Validation access is unavailable. The team needs to check the API key, enabled API and billing.',
    });
  if (status === 429)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Address lookup has reached its usage limit. Try again later.',
    });
  if (status < 200 || status >= 300)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'Address lookup is unavailable. Try again later.',
    });
  const parsed = z
    .object({
      result: z.object({
        verdict: z.object({
          addressComplete: z.boolean().optional(),
          validationGranularity: z.string(),
          hasUnconfirmedComponents: z.boolean().optional(),
          hasInferredComponents: z.boolean().optional(),
          hasReplacedComponents: z.boolean().optional(),
        }),
        address: z.object({ formattedAddress: z.string() }),
        geocode: z
          .object({
            placeId: z.string().min(1),
            location: z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            }),
          })
          .optional(),
      }),
    })
    .safeParse(payload);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'Address lookup returned an unexpected response. Try again later.',
    });
  const { verdict, address: matched, geocode } = parsed.data.result;
  if (
    !geocode ||
    !['PREMISE', 'SUB_PREMISE'].includes(verdict.validationGranularity) ||
    !verdict.addressComplete ||
    verdict.hasUnconfirmedComponents
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Google could not confirm a complete delivery address. Check the street, apartment, city and ZIP, then try again.',
    });
  return {
    googlePlaceId: geocode.placeId,
    latitude: geocode.location.latitude,
    longitude: geocode.location.longitude,
    geocodedAddress: matched.formattedAddress,
    needsReview: !!(
      verdict.hasInferredComponents || verdict.hasReplacedComponents
    ),
  };
}

async function placesRequest(
  url: string,
  apiKey: string | undefined,
  options: RequestInit,
  request: typeof fetch,
) {
  if (!apiKey)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Address suggestions have not been configured.',
    });
  let response: Response;
  try {
    response = await request(url, {
      ...options,
      headers: { ...options.headers, 'X-Goog-Api-Key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'Address suggestions are unavailable. You can enter your address manually.',
    });
  }
  if (response.status === 401 || response.status === 403)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Address suggestions require Places API (New) to be enabled and allowed on the server API key. You can enter your address manually.',
    });
  if (response.status === 429)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message:
        'Address suggestions have reached their usage limit. You can enter your address manually.',
    });
  if (!response.ok)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'Address suggestions are unavailable. You can enter your address manually.',
    });
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'Address suggestions returned an unexpected response.',
    });
  }
}
export async function suggestAddresses(
  input: string,
  sessionToken: string,
  apiKey: string | undefined,
  request: typeof fetch = fetch,
  location: NetworkLocation = {},
) {
  const data = await placesRequest(
    'https://places.googleapis.com/v1/places:autocomplete',
    apiKey,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['us'],
        languageCode: 'en',
        ...(location.autocompleteBias
          ? {
              locationBias: {
                circle: {
                  center: {
                    latitude: location.autocompleteBias.latitude,
                    longitude: location.autocompleteBias.longitude,
                  },
                  radius: location.autocompleteBias.radiusMeters,
                },
              },
            }
          : {}),
      }),
    },
    request,
  );
  const parsed = z
    .object({
      suggestions: z
        .array(
          z.object({
            placePrediction: z
              .object({
                placeId: z.string(),
                text: z.object({ text: z.string() }),
              })
              .optional(),
          }),
        )
        .default([]),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'Address suggestions returned an unexpected response.',
    });
  return parsed.data.suggestions.flatMap((item) =>
    item.placePrediction
      ? [
          {
            placeId: item.placePrediction.placeId,
            label: item.placePrediction.text.text,
          },
        ]
      : [],
  );
}
export async function resolveAddress(
  placeId: string,
  sessionToken: string,
  apiKey: string | undefined,
  request: typeof fetch = fetch,
) {
  const url = new URL(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
  );
  url.searchParams.set('sessionToken', sessionToken);
  const data = await placesRequest(
    url.toString(),
    apiKey,
    { headers: { 'X-Goog-FieldMask': 'addressComponents' } },
    request,
  );
  const parsed = z
    .object({
      addressComponents: z.array(
        z.object({
          longText: z.string(),
          shortText: z.string().optional(),
          types: z.array(z.string()),
        }),
      ),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        'Address details are unavailable. You can enter your address manually.',
    });
  const component = (type: string, short = false) => {
    const item = parsed.data.addressComponents.find((part) =>
      part.types.includes(type),
    );
    return (short ? item?.shortText : item?.longText) ?? item?.longText ?? '';
  };
  if (component('country', true) !== 'US')
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose a United States address.',
    });
  const street = [component('street_number'), component('route')]
    .filter(Boolean)
    .join(' ');
  if (!street)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose a street address or enter it manually.',
    });
  return {
    street,
    city:
      component('locality') ||
      component('postal_town') ||
      component('sublocality_level_1'),
    region: component('administrative_area_level_1', true),
    postalCode: component('postal_code'),
  };
}
