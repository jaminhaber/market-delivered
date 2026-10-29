import type { OrderStatus } from '@market/api/router';

// Presentation choice: the API returns all statuses unless a list is supplied.
export const nonCancelledOrderStatuses: OrderStatus[] = [
  'placed',
  'claimed',
  'shopping',
  'ready',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'unavailable',
];
