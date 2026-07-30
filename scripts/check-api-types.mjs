/*
 * Fails when src/api/schema.d.ts no longer matches the server's openapi.yaml.
 *
 * The generated file is committed so a build never needs the sibling repo
 * checked out. The cost of that is it can go stale silently, and a stale
 * contract is worse than no contract: the compiler keeps agreeing with you
 * about a shape the server stopped sending.
 *
 * So this regenerates into a temporary file and compares. When the sibling repo
 * is absent — CI checks out one repo — it prints a notice and passes, because
 * there is nothing to compare against and failing would only teach people to
 * skip `npm run check`.
 *
 * Plain Node, no dependency, same house style as the server's check-openapi.mjs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = '../foodbankserver/openapi.yaml';
const COMMITTED = 'src/api/schema.d.ts';

if (!existsSync(SPEC)) {
  console.log(`api:types:check — skipped, ${SPEC} not found (the API repo is not checked out).`);
  process.exit(0);
}

if (!existsSync(COMMITTED)) {
  console.error(`api:types:check — ${COMMITTED} is missing. Run \`npm run api:types\`.`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'foodbank-api-types-'));
const regenerated = join(scratch, 'schema.d.ts');

try {
  execFileSync('npx', ['openapi-typescript', SPEC, '-o', regenerated], { stdio: 'pipe' });

  const before = readFileSync(COMMITTED, 'utf8');
  const after = readFileSync(regenerated, 'utf8');

  if (before !== after) {
    console.error(
      `api:types:check — ${COMMITTED} is out of date with ${SPEC}.\n` +
        'Run `npm run api:types`, then read the type errors: they are the list of\n' +
        'things the API changed under you.',
    );
    process.exit(1);
  }

  console.log(`api:types:check — ${COMMITTED} matches ${SPEC}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
