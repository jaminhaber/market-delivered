import type { APIRoute } from 'astro';
import { inventoryResponse } from '../../server/inventory';

export const GET: APIRoute = () => inventoryResponse();
