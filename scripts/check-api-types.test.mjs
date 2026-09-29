import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const clientDir = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./check-api-types.mjs', import.meta.url));

// A promote runs the client's checks in a worktree with no sibling server, so a
// skip here would pass a pair whose contracts were never compared.
test('a FOODBANK_SERVER_DIR without openapi.yaml fails rather than skips', () => {
  const emptyServer = mkdtempSync(join(tmpdir(), 'foodbank-no-server-'));
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: clientDir,
      env: { ...process.env, FOODBANK_SERVER_DIR: emptyServer },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${emptyServer}/openapi\\.yaml not found`));
  } finally {
    rmSync(emptyServer, { recursive: true, force: true });
  }
});
