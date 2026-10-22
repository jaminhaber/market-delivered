import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: ['@market/db'],
  external: ['pg'],
  clean: true,
  sourcemap: true,
});
