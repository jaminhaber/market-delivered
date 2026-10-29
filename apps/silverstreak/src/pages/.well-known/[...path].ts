import type { APIRoute } from 'astro';
import { proxyMcpRequest } from '../../server/market-proxy';
export const GET: APIRoute = proxyMcpRequest;
