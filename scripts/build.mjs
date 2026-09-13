/*
 * Builds one named client release.
 *
 * The browser bundle embeds this version and Vite copies the matching public
 * asset. Two things read it: a tab left open through a deployment compares
 * the two at its next successful sign-in (src/lib/client-version.ts), and a
 * person can `curl` /client-version.json on test and live to see which
 * commit each is actually running.
 *
 * That second use is why the version is the git commit, not a random id —
 * deploys here are run by hand from a developer's checkout (see the
 * "Test-system deployment commands" in README.md), so there is no CI-issued
 * build number to fall back on, and a random id would tell a human nothing.
 * `-dirty` is appended when the working tree has uncommitted changes, since
 * a local deploy can otherwise ship code no commit describes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
const isDirty = execFileSync('git', ['status', '--porcelain']).toString().trim() !== '';
const version = isDirty ? `${commit}-dirty` : commit;
const environment = { ...process.env, CLIENT_BUILD_VERSION: version };

execFileSync('npx', ['tsc', '-b'], { stdio: 'inherit', env: environment });
mkdirSync('public', { recursive: true });
writeFileSync('public/client-version.json', `${JSON.stringify({ version })}\n`);
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', env: environment });
