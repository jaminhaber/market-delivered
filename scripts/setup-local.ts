import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.NODE_ENV === 'production')
  throw new Error('Local setup is disabled in production');
const root = resolve(import.meta.dirname, '..');
const target = resolve(root, '.env');
if (!existsSync(target)) copyFileSync(resolve(root, '.env.example'), target);
let source = readFileSync(target, 'utf8');
for (const name of ['BETTER_AUTH_SECRET', 'ADMIN_AUTH_SECRET', 'CRON_SECRET']) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const current = source
    .match(pattern)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  if (current && !current.startsWith('replace-with-')) continue;
  const line = `${name}=${randomBytes(32).toString('hex')}`;
  source = pattern.test(source)
    ? source.replace(pattern, line)
    : source.trimEnd() + '\n' + line + '\n';
}
if (!/^ADMIN_ORIGIN=/m.test(source))
  source = source.trimEnd() + '\nADMIN_ORIGIN=http://localhost:5173\n';
writeFileSync(target, source, { mode: 0o600 });
const silver = resolve(root, 'apps/silverstreak/.env');
if (!existsSync(silver))
  copyFileSync(resolve(root, 'apps/silverstreak/.env.example'), silver);
console.log(
  'Local environment files are ready. Existing secrets were preserved. Start Docker, then run npm run db:up and npm run dev.',
);
console.log(
  'After creating a network, set SILVERSTREAK_NETWORK_ID in apps/silverstreak/.env.',
);
