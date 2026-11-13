import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api';
import { Driver } from './Driver';

const root = document.getElementById('driver-root');
if (root)
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <Driver />
    </QueryClientProvider>,
  );
