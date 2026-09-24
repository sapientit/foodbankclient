#!/usr/bin/env node

/**
 * Checks one proposed Questionnaire/Rules release against the stock catalogue
 * in a development or test Foodbank system. It is deliberately a local tool:
 * the Sheet remains authoring input and the application still releases JSON.
 */

import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';
import { URL, URLSearchParams, fileURLToPath } from 'node:url';

import {
  appendFrozenEntries,
  dynamicQuestionEntries,
  newFrozenEntries,
  parseFrozenAnswerKeys,
} from './import-questionnaire.mjs';
import {
  parsePreferenceRuleConfig,
  validatePreferenceRuleReferences,
} from './import-preference-rules.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = process.env.FOODBANK_CLIENT_ROOT ?? resolve(scriptDirectory, '..');

const pathsFor = (projectRoot) => ({
  questionnaire: resolve(projectRoot, 'src/features/referrals/referral-form.config.json'),
  ledger: resolve(projectRoot, 'src/features/referrals/referral-answer-keys.frozen.ts'),
  rules: resolve(projectRoot, 'src/features/pick-lists/preference-rules.config.json'),
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ruleLines(rule) {
  return [...(rule.cases?.flatMap((entry) => entry.set) ?? []), ...(rule.otherwise?.set ?? [])];
}

/** Matches the application’s trimmed, case-insensitive stock-name comparison. */
function normaliseStockItemName(name) {
  return name.trim().toLowerCase();
}

/** The Node equivalent of the application's environment-specific rule health check. */
export function validateRuleStockReferences(questionnaire, rules, stockItems) {
  const preferences = new Map();
  if (isRecord(questionnaire) && Array.isArray(questionnaire.pages)) {
    for (const page of questionnaire.pages) {
      if (!isRecord(page) || !Array.isArray(page.questions)) continue;
      for (const question of page.questions) {
        if (
          isRecord(question) &&
          question.keyField === undefined &&
          question.preference === true &&
          typeof question.questionKey === 'string'
        ) {
          preferences.set(question.questionKey, question);
        }
      }
    }
  }
  const activeByName = new Map();
  for (const item of stockItems) {
    if (!isRecord(item) || item.isActive !== true || typeof item.name !== 'string') continue;
    const key = normaliseStockItemName(item.name);
    const matchingItems = activeByName.get(key) ?? [];
    matchingItems.push(item);
    activeByName.set(key, matchingItems);
  }

  const remainingOptions = new Map();
  const errors = [];
  for (const rule of rules.rules) {
    const question = preferences.get(rule.when.key);
    if (question === undefined) continue;
    const isChoice = isRecord(question.validation) && question.validation.type === 'CheckBox';
    const answers =
      isChoice && Array.isArray(question.answers)
        ? question.answers.filter((answer) => typeof answer === 'string')
        : [];
    for (const line of ruleLines(rule)) {
      if (line.stock === '$dummy') {
        continue;
      }
      if (line.stock === '$selectedAnswer') {
        if (!isChoice) {
          errors.push(`Rule ${rule.when.key}: $selectedAnswer needs a choice preference question.`);
          continue;
        }
        const options = remainingOptions.get(question.questionKey) ?? answers;
        remainingOptions.set(question.questionKey, options);
        const unavailable = options.filter(
          (answer) => activeByName.get(normaliseStockItemName(answer))?.length !== 1,
        );
        if (unavailable.length > 0)
          errors.push(
            `Rule ${rule.when.key}: $selectedAnswer cannot resolve active stock items for ${unavailable.join(', ')}.`,
          );
      } else if (activeByName.get(normaliseStockItemName(line.stock))?.length !== 1) {
        errors.push(
          `Rule ${rule.when.key}: active stock item ${line.stock} does not exist uniquely.`,
        );
      }
    }
    if (isChoice) {
      const options = remainingOptions.get(question.questionKey) ?? answers;
      remainingOptions.set(
        question.questionKey,
        rule.when.hasAnswer === undefined
          ? []
          : options.filter((answer) => answer !== rule.when.hasAnswer),
      );
    }
  }
  return [...new Set(errors)];
}

/** Validates all proposed configuration in memory; it never changes the repository. */
export function validateTakeon({ questionnaireInput, rulesInput, frozenLedger, stockItems }) {
  const errors = [];
  let questionnaire;
  let rules;
  let newEntries = [];
  try {
    questionnaire = JSON.parse(questionnaireInput);
  } catch (error) {
    errors.push(
      `The questionnaire is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    rules = parsePreferenceRuleConfig(JSON.parse(rulesInput));
  } catch (error) {
    errors.push(
      `The preference rules are invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (questionnaire !== undefined) {
    try {
      newEntries = newFrozenEntries(
        dynamicQuestionEntries(questionnaire),
        parseFrozenAnswerKeys(frozenLedger),
      );
    } catch (error) {
      errors.push(
        `The questionnaire is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (questionnaire !== undefined && rules !== undefined) {
    errors.push(...validatePreferenceRuleReferences(rules, questionnaire));
    errors.push(...validateRuleStockReferences(questionnaire, rules, stockItems));
  }
  return { errors: [...new Set(errors)], questionnaire, rules, newEntries };
}

async function readAdminSession({ baseUrl, email, fetchImpl = globalThis.fetch }) {
  const base = baseUrl.replace(/\/$/, '');
  let login;
  try {
    login = await fetchImpl(`${base}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    throw new Error(
      `Could not sign in to ${base}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!login.ok)
    throw new Error(`Could not sign in to ${base}: the server returned ${login.status}.`);
  const session = await login.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string' || session.accessToken === '')
    throw new Error(`Could not sign in to ${base}: the server did not return an access token.`);
  if (!isRecord(session.user) || session.user.role !== 'admin')
    throw new Error(`Could not use ${base}: ${email} is not an administrator.`);
  return { base, accessToken: session.accessToken };
}

export async function readActiveStock({ baseUrl, email, fetchImpl = globalThis.fetch }) {
  const { base, accessToken } = await readAdminSession({ baseUrl, email, fetchImpl });

  let response;
  try {
    response = await fetchImpl(`${base}/api/v1/stock/items?includeInactive=true&order=category`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw new Error(
      `Could not read stock from ${base}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!response.ok)
    throw new Error(`Could not read stock from ${base}: the server returned ${response.status}.`);
  const body = await response.json();
  if (!isRecord(body) || !Array.isArray(body.items))
    throw new Error(
      `Could not read stock from ${base}: the server returned an invalid stock list.`,
    );
  return body.items;
}

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const QUESTIONNAIRE_RANGE = 'Generated Questionnaire JSON!A2';
const RULES_RANGE = 'Generated Rules JSON!A2';

function base64Url(bytes) {
  return bytes.toString('base64url');
}

export function createGoogleAuthorizationUrl({ clientId, redirectUri, state, verifier }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: base64Url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SHEETS_SCOPE,
    state,
  }).toString();
  return url.toString();
}

export function createGoogleTokenExchangeBody({
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri,
}) {
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
}

/** Keeps an OAuth failure actionable without echoing the authorisation code or token response. */
export function describeGoogleTokenFailure(response, token) {
  const status = typeof response.status === 'number' ? ` (HTTP ${String(response.status)})` : '';
  if (!isRecord(token)) return `Google did not return a Sheets access token${status}.`;
  const error = typeof token.error === 'string' ? token.error : undefined;
  const description =
    typeof token.error_description === 'string'
      ? token.error_description.replace(/\s+/g, ' ').trim().slice(0, 500)
      : undefined;
  const details = [error, description].filter((detail) => detail !== undefined);
  return details.length === 0
    ? `Google did not return a Sheets access token${status}.`
    : `Google did not return a Sheets access token${status}: ${details.join(' — ')}`;
}

/** Uses a Desktop OAuth client. The short-lived Sheets token never reaches disk. */
export async function requestReadonlySheetsAccess({
  googleClientId,
  googleClientSecret,
  fetchImpl = globalThis.fetch,
  port = 0,
  timeoutMs = 5 * 60 * 1000,
  createServerImpl = createServer,
  random = randomBytes,
}) {
  const state = base64Url(random(32));
  const verifier = base64Url(random(48));
  let finishCallback;
  const receivedCode = new Promise((resolve, reject) => {
    finishCallback = { resolve, reject };
  });
  const server = createServerImpl((request, response) => {
    const callback = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || callback.pathname !== '/oauth2/callback') {
      response.writeHead(404).end();
      return;
    }
    const returnedState = callback.searchParams.get('state');
    const code = callback.searchParams.get('code');
    const receivedState = returnedState === null ? null : Buffer.from(returnedState);
    const expectedState = Buffer.from(state);
    if (
      receivedState === null ||
      receivedState.length !== expectedState.length ||
      !timingSafeEqual(receivedState, expectedState)
    ) {
      response.writeHead(400).end('Google sign-in could not be verified.');
      return;
    }
    if (callback.searchParams.has('error') || code === null) {
      response.writeHead(400).end('Google permission was not granted.');
      finishCallback.reject(new Error('Google permission was not granted.'));
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<p>Google permission granted. You may close this window.</p>');
    finishCallback.resolve(code);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Could not start Google sign-in.');
  const redirectUri = `http://127.0.0.1:${String(address.port)}/oauth2/callback`;
  const authorizationUrl = createGoogleAuthorizationUrl({
    clientId: googleClientId,
    redirectUri,
    state,
    verifier,
  });
  process.stdout.write(`Open this Google sign-in address in your browser:\n${authorizationUrl}\n`);
  let timeout;
  try {
    const code = await Promise.race([
      receivedCode,
      new Promise((_, reject) => {
        timeout = setTimer(
          () => reject(new Error('Google permission was not granted within five minutes.')),
          timeoutMs,
        );
      }),
    ]);
    const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: createGoogleTokenExchangeBody({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        code,
        verifier,
        redirectUri,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !isRecord(token) || typeof token.access_token !== 'string')
      throw new Error(describeGoogleTokenFailure(tokenResponse, token));
    return token.access_token;
  } finally {
    clearTimer(timeout);
    server.close();
  }
}

export async function readGeneratedConfiguration({
  spreadsheetId,
  accessToken,
  fetchImpl = globalThis.fetch,
}) {
  const ranges = [QUESTIONNAIRE_RANGE, RULES_RANGE];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&');
  const response = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`Google Sheets could not read the generated JSON (${response.status}).`);
  const valueRanges = isRecord(body) && Array.isArray(body.valueRanges) ? body.valueRanges : [];
  function readCell(range, index) {
    const entry = valueRanges[index];
    const value = isRecord(entry) && Array.isArray(entry.values) ? entry.values[0]?.[0] : undefined;
    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(`${range} is empty. Generate and review its JSON in the workbook first.`);
    return value;
  }
  return {
    questionnaireInput: readCell(QUESTIONNAIRE_RANGE, 0),
    rulesInput: readCell(RULES_RANGE, 1),
  };
}

function writeAtomically(path, content) {
  const temporaryPath = `${path}.takeon-${process.pid}`;
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

function run(command, arguments_, projectRoot) {
  const result = spawnSync(command, arguments_, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${arguments_.join(' ')} failed.`);
}

/** Runs the application's real form parser without replacing its released JSON. */
export function validateQuestionnaireWithApplicationParser({
  input,
  projectRoot = defaultProjectRoot,
  spawn = spawnSync,
}) {
  const result = spawn(
    'npx',
    ['vitest', 'run', 'test/tools/takeon-questionnaire-validation.test.ts'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, VITE_FOODBANK_TAKEON_QUESTIONNAIRE: input },
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((output) => typeof output === 'string' && output.trim() !== '')
      .join('\n')
      .trim();
    throw new Error(`The questionnaire is invalid.${detail === '' ? '' : `\n${detail}`}`);
  }
}

/** Writes every release artefact together and restores all of them if a gate fails. */
export function writeTakeon({
  questionnaire,
  rules,
  newEntries,
  projectRoot = defaultProjectRoot,
  runCommand = run,
}) {
  const paths = pathsFor(projectRoot);
  const original = Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
  );
  try {
    writeAtomically(paths.questionnaire, `${JSON.stringify(questionnaire, null, 2)}\n`);
    writeAtomically(paths.ledger, appendFrozenEntries(original.ledger, newEntries));
    writeAtomically(paths.rules, `${JSON.stringify(rules, null, 2)}\n`);
    runCommand(
      'npx',
      ['prettier', '--write', paths.questionnaire, paths.ledger, paths.rules],
      projectRoot,
    );
    runCommand(
      'npx',
      ['vitest', 'run', 'src/features/referrals/referral-form-config.test.ts'],
      projectRoot,
    );
    runCommand(
      'npx',
      ['vitest', 'run', 'src/features/pick-lists/preference-rules.config.test.ts'],
      projectRoot,
    );
  } catch (error) {
    for (const [key, path] of Object.entries(paths)) writeAtomically(path, original[key]);
    throw error;
  }
}

function usage() {
  return `Usage: validate-foodbank-takeon --base-url URL --email EMAIL --spreadsheet-id ID --google-client-id ID [--write]\n       validate-foodbank-takeon --base-url URL --email EMAIL --questionnaire FILE --rules FILE [--write]\n\nReads reviewed JSON directly from the authoring workbook, or accepts both saved files as an offline fallback.\nWithout --write it changes nothing. --write updates the client configuration only after validation.\n`;
}

function parseArguments(arguments_) {
  const result = { write: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--write') result.write = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (
      [
        '--base-url',
        '--email',
        '--questionnaire',
        '--rules',
        '--spreadsheet-id',
        '--google-client-id',
      ].includes(argument)
    ) {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${argument} needs a value.`);
      result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return process.stdout.write(usage());
  for (const key of ['baseUrl', 'email']) {
    if (typeof options[key] !== 'string')
      throw new Error(
        `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required.`,
      );
  }
  const usesFiles = typeof options.questionnaire === 'string' || typeof options.rules === 'string';
  const usesWorkbook =
    typeof options.spreadsheetId === 'string' || typeof options.googleClientId === 'string';
  if (usesFiles && (typeof options.questionnaire !== 'string' || typeof options.rules !== 'string'))
    throw new Error('--questionnaire and --rules must be supplied together.');
  if (
    usesWorkbook &&
    (typeof options.spreadsheetId !== 'string' || typeof options.googleClientId !== 'string')
  )
    throw new Error('--spreadsheet-id and --google-client-id must be supplied together.');
  if (usesFiles === usesWorkbook)
    throw new Error('Choose either direct workbook access or both saved JSON files.');
  const googleClientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET;
  if (usesWorkbook && (typeof googleClientSecret !== 'string' || googleClientSecret === ''))
    throw new Error('GOOGLE_SHEETS_CLIENT_SECRET is required for direct workbook access.');
  const paths = pathsFor(defaultProjectRoot);
  const stockItems = await readActiveStock({ baseUrl: options.baseUrl, email: options.email });
  const source = usesFiles
    ? {
        questionnaireInput: readFileSync(options.questionnaire, 'utf8'),
        rulesInput: readFileSync(options.rules, 'utf8'),
      }
    : await readGeneratedConfiguration({
        spreadsheetId: options.spreadsheetId,
        accessToken: await requestReadonlySheetsAccess({
          googleClientId: options.googleClientId,
          googleClientSecret,
        }),
      });
  validateQuestionnaireWithApplicationParser({
    input: source.questionnaireInput,
  });
  const result = validateTakeon({
    questionnaireInput: source.questionnaireInput,
    rulesInput: source.rulesInput,
    frozenLedger: readFileSync(paths.ledger, 'utf8'),
    stockItems,
  });
  if (result.errors.length > 0)
    throw new Error(
      `Take-on validation failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}`,
    );
  if (result.questionnaire === undefined || result.rules === undefined)
    throw new Error('Take-on validation failed.');
  if (options.write) {
    writeTakeon({
      questionnaire: result.questionnaire,
      rules: result.rules,
      newEntries: result.newEntries,
    });
    process.stdout.write(
      'Take-on validation passed and client configuration was updated. Review the diff and run npm run check before release.\n',
    );
  } else {
    process.stdout.write(
      'Take-on validation passed. No files were changed; rerun with --write to update the client configuration.\n',
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
