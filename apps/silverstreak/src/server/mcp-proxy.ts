import type { APIContext } from 'astro';
import { proxyNetworkMcp } from '@market/mcp/proxy';
import { marketConfig } from './market';

export async function proxyAssistantRequest({ request, url }: APIContext) {
  try {
    return await proxyNetworkMcp(request, url, marketConfig());
  } catch {
    return Response.json(
      { error: 'The assistant connection is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
