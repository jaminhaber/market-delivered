import type { APIRoute } from 'astro';
import { proxyMcpRequest } from '../../../server/market-proxy';
export const ALL: APIRoute = proxyMcpRequest;
