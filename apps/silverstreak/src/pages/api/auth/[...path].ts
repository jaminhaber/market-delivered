import type { APIRoute } from 'astro';
import { proxyMarketRequest } from '../../../server/market-proxy';

export const GET: APIRoute = proxyMarketRequest;
export const POST: APIRoute = proxyMarketRequest;
