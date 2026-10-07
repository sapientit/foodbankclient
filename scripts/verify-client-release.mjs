#!/usr/bin/env node
/**
 * Assert that a deployed Workers asset set is exactly the one we built.
 *
 * This is deliberately an external, black-box check. The Workers SPA fallback
 * returns index.html for a missing hashed module, so checking just that the
 * shell loads or that client-version.json changed cannot prove a browser can
 * start the application.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const usage = `usage: node scripts/verify-client-release.mjs --url URL --expected-version VERSION [--dist DIRECTORY]`;
const requestTimeoutMs = 10_000;

function readOption(name, required = true) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    if (!required) return undefined;
    throw new Error(usage);
  }
  if (!process.argv[index + 1]) throw new Error(usage);
  return process.argv[index + 1];
}

function localAssetPaths(html) {
  const paths = new Set();
  const tagPattern = /<(?:script|link)\b[^>]*>/gi;
  for (const tag of html.match(tagPattern) ?? []) {
    const isModule = /<script\b/i.test(tag) && /\btype=["']module["']/i.test(tag);
    const isStyle = /<link\b/i.test(tag) && /\brel=["']stylesheet["']/i.test(tag);
    const isModulePreload = /<link\b/i.test(tag) && /\brel=["']modulepreload["']/i.test(tag);
    if (!isModule && !isStyle && !isModulePreload) continue;
    const match = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
    if (!match || !match[1].startsWith('/')) continue;
    paths.add(match[1]);
  }
  return paths;
}

async function filesBelow(directory, relative = '') {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(directory, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function requestUrl(origin, assetPath) {
  const url = new URL(assetPath, origin);
  // A unique query string makes this probe independent of an intermediary's
  // stale cache entry. The asset lookup ignores it.
  url.searchParams.set('__release_probe', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return url;
}

async function get(origin, assetPath) {
  const response = await globalThis.fetch(requestUrl(origin, assetPath), {
    headers: { 'cache-control': 'no-cache' },
    signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
  });
  return response;
}

function assertContentType(response, extension, assetPath) {
  const contentType = response.headers.get('content-type') ?? '';
  if (extension === '.js') {
    assert.match(
      contentType,
      /^(?:application|text)\/javascript\b/i,
      `${assetPath} is not JavaScript (${contentType || 'no content type'})`,
    );
  }
  if (extension === '.css') {
    assert.match(
      contentType,
      /^text\/css\b/i,
      `${assetPath} is not CSS (${contentType || 'no content type'})`,
    );
  }
}

async function main() {
  const origin = new URL(readOption('--url'));
  const dist = readOption('--dist', false);
  const expectedVersion = readOption('--expected-version');
  const expectedHtml = dist ? await readFile(path.join(dist, 'index.html'), 'utf8') : undefined;
  const remoteIndex = await get(origin, '/');
  assert.equal(remoteIndex.status, 200, `application shell returned HTTP ${remoteIndex.status}`);
  assert.match(
    remoteIndex.headers.get('content-type') ?? '',
    /^text\/html\b/i,
    'application shell is not HTML',
  );
  const actualHtml = await remoteIndex.text();
  if (expectedHtml !== undefined) {
    assert.equal(
      actualHtml,
      expectedHtml,
      'deployed index.html does not match the just-built index.html',
    );
  }

  const expectedVersionResponse = await get(origin, '/client-version.json');
  assert.equal(
    expectedVersionResponse.status,
    200,
    `client-version.json returned HTTP ${expectedVersionResponse.status}`,
  );
  const versionBody = await expectedVersionResponse.json();
  assert.equal(
    versionBody?.version,
    expectedVersion,
    'client-version.json does not match this build',
  );

  const htmlAssets = localAssetPaths(actualHtml);
  const assetFiles =
    dist === undefined
      ? [...htmlAssets].map((asset) => asset.slice(1))
      : (await filesBelow(dist)).filter(
          (file) =>
            !file.startsWith('.vite/') &&
            file !== '.assetsignore' &&
            file !== 'index.html' &&
            file !== 'client-version.json' &&
            file !== 'wrangler.json',
        );
  for (const asset of htmlAssets) {
    if (dist !== undefined) {
      assert(
        assetFiles.includes(asset.slice(1)),
        `index.html references ${asset}, which is absent from the local build`,
      );
    }
  }

  for (const file of assetFiles) {
    const assetPath = `/${file.split(path.sep).join('/')}`;
    const response = await get(origin, assetPath);
    assert.equal(response.status, 200, `${assetPath} returned HTTP ${response.status}`);
    assertContentType(response, path.extname(file), assetPath);
  }

  console.log(
    `PASS: ${origin.origin} serves the exact built shell, version and ${assetFiles.length} assets`,
  );
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
});
