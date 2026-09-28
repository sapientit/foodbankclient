import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));

test('the document sends only its origin to cross-site Google Sign-In', async () => {
  const indexHtml = await readFile(indexPath, 'utf8');

  assert.match(indexHtml, /<meta name="referrer" content="strict-origin-when-cross-origin"\s*\/>/);
});
