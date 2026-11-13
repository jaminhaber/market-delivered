import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@market/api/router';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
export const rpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/trpc' })],
});
export const api = createTRPCOptionsProxy<AppRouter>({
  client: rpc,
  queryClient,
});
