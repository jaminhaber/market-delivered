import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { QueryClient } from '@tanstack/react-query';
import type { AdminRouter } from '@market/api/router';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
export const rpc = createTRPCClient<AdminRouter>({
  links: [
    httpBatchLink({
      url: '/admin/trpc',
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: 'include' }),
    }),
  ],
});
export const api = createTRPCOptionsProxy<AdminRouter>({
  client: rpc,
  queryClient,
});
