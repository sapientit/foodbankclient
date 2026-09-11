#!/usr/bin/env node

/** Loads a reviewed prepared-scenario file through the dev/test-only import API. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const environments = {
  dev: 'http://127.0.0.1:8787',
  test: 'https://foodbank-server.losttemple.workers.dev',
};

function fail(message) {
  throw new Error(message);
}

function stableImportKey(sessionId, reasonId, referrals) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ sessionId, reasonId, referrals }))
    .digest('hex');
  // A deterministic version-5-shaped UUID satisfies the server contract while
  // retaining the idempotency property of the complete request scenario.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${
    ['8', '9', 'a', 'b'][Number.parseInt(digest[16], 16) % 4]
  }${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function readJson(response, description) {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    fail(`${description} failed (${response.status}): ${body?.error?.message ?? 'no message'}`);
  return body;
}

/** Purely validates the prepared file before anything is sent to a system. */
export function preparedReferrals(source) {
  if (typeof source !== 'object' || source === null || !Array.isArray(source.referrals))
    fail('The source is not a prepared anonymised-referrals JSON file.');
  if (source.referrals.length === 0) fail('The prepared source contains no referrals.');
  for (const referral of source.referrals) {
    if (typeof referral !== 'object' || referral === null)
      fail('The prepared source has an invalid referral.');
    if ('sessionId' in referral || 'reasonId' in referral)
      fail('The source is target-specific; prepare a system-independent source first.');
    if (
      typeof referral.referrerEmail !== 'string' ||
      !referral.referrerEmail.endsWith('@example.test')
    )
      fail('The source contains a non-synthetic referrer email.');
  }
  return source.referrals;
}

export async function loadAnonymisedReferrals({
  environment,
  sessionDate,
  startTime,
  email,
  source,
  fetchFn = globalThis.fetch,
}) {
  const baseUrl = environments[environment];
  if (baseUrl === undefined) fail('Use --dev or --test. Live loading is deliberately unsupported.');
  if (sessionDate === '' || startTime === '') fail('A session date and start time are required.');
  if (email === '') fail('An administrator email is required.');
  const referrals = preparedReferrals(source);
  const login = await readJson(
    await fetchFn(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
    'Administrator login',
  );
  if (typeof login.accessToken !== 'string' || login.user?.role !== 'admin')
    fail('Administrator login did not return an administrator session.');
  const sessions = await readJson(
    await fetchFn(`${baseUrl}/api/v1/sessions`, { headers: { authorization: `Bearer ${login.accessToken}` } }),
    'Session lookup',
  );
  const matches = (sessions.sessions ?? []).filter((session) => session.sessionDate === sessionDate && session.startTime === startTime);
  if (matches.length !== 1 || typeof matches[0]?.id !== 'string')
    fail(`Expected exactly one session at ${sessionDate} ${startTime}; found ${String(matches.length)}.`);
  const sessionId = matches[0].id;
  const reasons = await readJson(
    await fetchFn(`${baseUrl}/api/v1/public/referral-reasons`),
    'Referral-reason lookup',
  );
  const reasonId = reasons.referralReasons?.[0]?.id;
  if (typeof reasonId !== 'string') fail('The target system has no referral reason to use.');
  const importKey = stableImportKey(sessionId, reasonId, referrals);
  const result = await readJson(
    await fetchFn(`${baseUrl}/api/v1/dev-test/referral-imports`, {
      method: 'POST',
      headers: { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ importKey, sessionId, reasonId, referrals }),
    }),
    'Anonymised referral import',
  );
  return { importKey, result };
}

function usage() {
  return 'Usage: load-anonymised-referrals --dev|--test --session-date YYYY-MM-DD --start-time HH:MM --source prepared.json --email ADMIN_EMAIL\n';
}

function argumentsFrom(argv) {
  const result = { environment: '', sessionDate: '', startTime: '', source: '', email: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dev' || argument === '--test') result.environment = argument.slice(2);
    else if (['--session-date', '--start-time', '--source', '--email'].includes(argument)) {
      const value = argv[++index];
      if (value === undefined) fail(`Missing value for ${argument}.`);
      result[{ '--session-date': 'sessionDate', '--start-time': 'startTime', '--source': 'source', '--email': 'email' }[argument]] =
        value;
    } else fail(usage());
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = argumentsFrom(process.argv.slice(2));
    const source = JSON.parse(readFileSync(arguments_.source, 'utf8'));
    const { importKey, result } = await loadAnonymisedReferrals({ ...arguments_, source });
    process.stdout.write(
      `Imported ${String(result.referrals?.length ?? 0)} anonymised referrals. Import key: ${importKey}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
