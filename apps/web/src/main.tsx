import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api';
import { BrandingPreviewProvider } from './Branding';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrandingPreviewProvider>
        <App />
      </BrandingPreviewProvider>
    </QueryClientProvider>
  </StrictMode>,
);
