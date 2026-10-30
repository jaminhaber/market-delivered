import type { APIRoute } from 'astro';
import { proxyAssistantRequest } from '../../../../server/mcp-proxy';

export const ALL: APIRoute = proxyAssistantRequest;
