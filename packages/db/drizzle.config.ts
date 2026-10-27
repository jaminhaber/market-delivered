import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/auth-schema.ts',
    './src/market-schema.ts',
    './src/network-schema.ts',
  ],
  out: './drizzle',
});
