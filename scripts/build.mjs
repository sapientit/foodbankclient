/*
 * Builds one named client release.
 *
 * The browser bundle embeds this UUID and Vite copies the matching public
 * asset. A tab left open through a deployment compares the two at its next
 * successful sign-in; see src/lib/client-version.ts.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const version = randomUUID();
const environment = { ...process.env, CLIENT_BUILD_VERSION: version };

execFileSync('npx', ['tsc', '-b'], { stdio: 'inherit', env: environment });
mkdirSync('public', { recursive: true });
writeFileSync('public/client-version.json', `${JSON.stringify({ version })}\n`);
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', env: environment });
