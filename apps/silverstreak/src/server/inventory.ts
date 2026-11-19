import type { PublicInventory } from '@market/api/router';
import { marketConfig } from './market';

export async function inventoryResponse() {
  try {
    const { origin, networkId } = marketConfig();
    // Never forward browser cookies or a caller's network selector to
    // this shared public response.
    const response = await fetch(
      `${origin}/api/public/networks/${encodeURIComponent(networkId)}/inventory`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error('Inventory unavailable');
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Age']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { headers });
  } catch {
    return Response.json(
      {
        error: 'The shop is temporarily unavailable. Please try again shortly.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function publicInventory(): Promise<PublicInventory> {
  const response = await inventoryResponse();
  if (!response.ok) throw new Error((await response.json()).error);
  return response.json();
}
