import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.mts'],
  format: ['esm'],
  // Preserve ESM semantics when deployed without this workspace's package.json.
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  noExternal: ['@market/db'],
  external: ['pg'],
  clean: true,
  sourcemap: true,
});
