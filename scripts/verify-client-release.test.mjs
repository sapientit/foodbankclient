import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';

const script = fileURLToPath(new URL('./verify-client-release.mjs', import.meta.url));

function runVerifier(url, dist, version) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      script,
      '--url',
      url,
      '--dist',
      dist,
      '--expected-version',
      version,
    ]);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function fixture() {
  const dist = await mkdtemp(path.join(tmpdir(), 'foodbank-release-'));
  await mkdir(path.join(dist, 'assets'));
  const index =
    '<!doctype html><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">';
  await Promise.all([
    writeFile(path.join(dist, 'index.html'), index),
    writeFile(path.join(dist, 'client-version.json'), '{"version":"abc123"}\n'),
    writeFile(path.join(dist, 'assets/app.js'), 'console.log("ok");'),
    writeFile(path.join(dist, 'assets/app.css'), 'body{}'),
  ]);
  return { dist, index };
}

async function withServer(responder, action) {
  const server = createServer(responder);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await action(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('accepts a release whose HTML, version and assets agree', async () => {
  const { dist, index } = await fixture();
  try {
    await withServer(
      (request, response) => {
        const pathname = new URL(request.url, 'http://example.test').pathname;
        const body =
          pathname === '/'
            ? index
            : pathname === '/client-version.json'
              ? '{"version":"abc123"}'
              : pathname === '/assets/app.js'
                ? 'console.log("ok");'
                : 'body{}';
        const type = pathname.endsWith('.js')
          ? 'application/javascript'
          : pathname.endsWith('.css')
            ? 'text/css'
            : pathname.endsWith('.json')
              ? 'application/json'
              : 'text/html';
        response.writeHead(200, { 'content-type': type });
        response.end(body);
      },
      async (url) => {
        const result = await runVerifier(url, dist, 'abc123');
        assert.equal(result.code, 0, result.output);
      },
    );
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('rejects the Workers SPA fallback returned for a missing module', async () => {
  const { dist, index } = await fixture();
  try {
    await withServer(
      (request, response) => {
        const pathname = new URL(request.url, 'http://example.test').pathname;
        if (pathname === '/assets/app.js') {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end(index);
          return;
        }
        const body =
          pathname === '/'
            ? index
            : pathname === '/client-version.json'
              ? '{"version":"abc123"}'
              : 'body{}';
        const type = pathname.endsWith('.css')
          ? 'text/css'
          : pathname.endsWith('.json')
            ? 'application/json'
            : 'text/html';
        response.writeHead(200, { 'content-type': type });
        response.end(body);
      },
      async (url) => {
        const result = await runVerifier(url, dist, 'abc123');
        assert.notEqual(result.code, 0);
        assert.match(result.output, /app\.js is not JavaScript/);
      },
    );
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
