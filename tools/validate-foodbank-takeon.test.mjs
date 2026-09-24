import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createGoogleAuthorizationUrl,
  createGoogleTokenExchangeBody,
  describeGoogleTokenFailure,
  readGeneratedConfiguration,
  readActiveStock,
  validateQuestionnaireWithApplicationParser,
  validateTakeon,
  writeTakeon,
} from './validate-foodbank-takeon.mjs';

const ledger = "export const FROZEN_ANSWER_KEYS = [\n  { key: 'Household', type: 'choice' },\n];\n";
const questionnaire = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Preferences',
      questions: [
        {
          questionNum: 1,
          questionKey: 'Household',
          questionTitle: 'Household items',
          preference: true,
          required: false,
          validation: { type: 'CheckBox', answerMin: 0, answerMax: 2 },
          answers: ['Soap', 'Washing powder'],
        },
      ],
    },
  ],
};
const rules = {
  rules: [
    {
      when: { key: 'Household' },
      otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
    },
  ],
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('validates proposed rules against active stock, without writing configuration', () => {
  const result = validateTakeon({
    questionnaireInput: JSON.stringify(questionnaire),
    rulesInput: JSON.stringify(rules),
    frozenLedger: ledger,
    stockItems: [
      { name: 'Soap', isActive: true },
      { name: 'Washing powder', isActive: true },
      { name: 'Retired item', isActive: false },
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.newEntries, []);
});

test('reports a retired, missing or duplicated active stock name for proposed rules', () => {
  const result = validateTakeon({
    questionnaireInput: JSON.stringify(questionnaire),
    rulesInput: JSON.stringify(rules),
    frozenLedger: ledger,
    stockItems: [
      { name: 'Soap', isActive: false },
      { name: 'Washing powder', isActive: true },
      { name: ' washing POWDER ', isActive: true },
    ],
  });

  assert.deepEqual(result.errors, [
    'Rule Household: $selectedAnswer cannot resolve active stock items for Soap, Washing powder.',
  ]);
});

test('uses the app’s ordered-rule semantics when resolving $selectedAnswer', () => {
  const orderedRules = {
    rules: [
      {
        when: { key: 'Household', hasAnswer: 'Soap' },
        otherwise: { set: [{ stock: 'Fixed soap replacement', quantity: 1 }] },
      },
      {
        when: { key: 'Household' },
        otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
      },
    ],
  };
  const result = validateTakeon({
    questionnaireInput: JSON.stringify(questionnaire),
    rulesInput: JSON.stringify(orderedRules),
    frozenLedger: ledger,
    stockItems: [
      { name: 'Fixed soap replacement', isActive: true },
      { name: 'Washing powder', isActive: true },
    ],
  });

  assert.deepEqual(result.errors, []);
});

test('accepts $dummy without an active stock item while preserving its required quantity', () => {
  const dummyRules = {
    rules: [
      {
        when: { key: 'Household', hasAnswer: 'Soap' },
        otherwise: { set: [{ stock: '$dummy', quantity: 1 }] },
      },
    ],
  };
  const result = validateTakeon({
    questionnaireInput: JSON.stringify(questionnaire),
    rulesInput: JSON.stringify(dummyRules),
    frozenLedger: ledger,
    stockItems: [],
  });

  assert.deepEqual(result.errors, []);
});

test('accepts $selectedAnswer for a preference whose choices come from a runtime list', () => {
  const questionnaireWithRuntimeChoices = {
    ...questionnaire,
    pages: [
      {
        ...questionnaire.pages[0],
        questions: [
          {
            ...questionnaire.pages[0].questions[0],
            validation: {
              type: 'CheckBox',
              answerMin: 0,
              answerMax: 1,
              optionsFrom: 'referralReasons',
              maxAnswerLength: 100,
            },
            answers: undefined,
          },
        ],
      },
    ],
  };
  const result = validateTakeon({
    questionnaireInput: JSON.stringify(questionnaireWithRuntimeChoices),
    rulesInput: JSON.stringify(rules),
    frozenLedger: ledger,
    stockItems: [],
  });

  assert.deepEqual(result.errors, []);
});

test('uses the application questionnaire parser before accepting a proposed take-on', () => {
  assert.throws(
    () =>
      validateQuestionnaireWithApplicationParser({
        input: JSON.stringify({ version: 1, pages: [] }),
        spawn: () => ({ status: 1, stdout: 'schema failed', stderr: '' }),
      }),
    /schema failed/,
  );
  const invocations = [];
  validateQuestionnaireWithApplicationParser({
    input: JSON.stringify(questionnaire),
    spawn: (command, arguments_, options) => {
      invocations.push({ command, arguments_, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(invocations[0]?.arguments_[2], 'test/tools/takeon-questionnaire-validation.test.ts');
  assert.equal(
    invocations[0]?.options.env.VITE_FOODBANK_TAKEON_QUESTIONNAIRE,
    JSON.stringify(questionnaire),
  );
});

test('reads the complete stock catalogue through the authenticated API', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/dev-login'))
      return response({ accessToken: 'short-lived-token', user: { role: 'admin' } });
    return response({ items: [{ name: 'Soap', isActive: true }] });
  };

  assert.deepEqual(
    await readActiveStock({
      baseUrl: 'http://example.test/',
      email: 'admin@example.test',
      fetchImpl,
    }),
    [{ name: 'Soap', isActive: true }],
  );
  assert.deepEqual(requests, [
    {
      url: 'http://example.test/api/v1/auth/dev-login',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.test' }),
      },
    },
    {
      url: 'http://example.test/api/v1/stock/items?includeInactive=true&order=category',
      init: { headers: { Authorization: 'Bearer short-lived-token' } },
    },
  ]);
});

test('refuses a non-administrator before reading stock', async () => {
  let stockRead = false;
  await assert.rejects(
    () =>
      readActiveStock({
        baseUrl: 'http://example.test',
        email: 'lead@example.test',
        fetchImpl: async (url) => {
          if (url.endsWith('/auth/dev-login'))
            return response({ accessToken: 'short-lived-token', user: { role: 'team_lead' } });
          stockRead = true;
          return response({ items: [] });
        },
      }),
    /not an administrator/,
  );
  assert.equal(stockRead, false);
});

test('creates a read-only Google PKCE authorisation address', () => {
  const url = new URL(
    createGoogleAuthorizationUrl({
      clientId: 'desktop-client',
      redirectUri: 'http://127.0.0.1:41000/oauth2/callback',
      state: 'state-value',
      verifier: 'verifier-value',
    }),
  );

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'desktop-client');
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  );
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.notEqual(url.searchParams.get('code_challenge'), 'verifier-value');
});

test('includes the Desktop OAuth client secret in the token exchange', () => {
  const body = createGoogleTokenExchangeBody({
    clientId: 'desktop-client',
    clientSecret: 'desktop-secret',
    code: 'one-time-code',
    verifier: 'pkce-verifier',
    redirectUri: 'http://127.0.0.1:41000/oauth2/callback',
  });

  assert.equal(body.get('client_id'), 'desktop-client');
  assert.equal(body.get('client_secret'), 'desktop-secret');
  assert.equal(body.get('code'), 'one-time-code');
  assert.equal(body.get('code_verifier'), 'pkce-verifier');
});

test('reports bounded Google token-exchange details without exposing a response body', () => {
  assert.equal(
    describeGoogleTokenFailure(
      { status: 400 },
      {
        error: 'invalid_grant',
        error_description: 'The supplied authorization code is invalid.\nIt may have expired.',
        access_token: 'must-not-appear',
      },
    ),
    'Google did not return a Sheets access token (HTTP 400): invalid_grant — The supplied authorization code is invalid. It may have expired.',
  );
  assert.equal(
    describeGoogleTokenFailure({ status: 500 }, { access_token: 'must-not-appear' }),
    'Google did not return a Sheets access token (HTTP 500).',
  );
});

test('reads both reviewed generated JSON cells directly from Google Sheets', async () => {
  const urls = [];
  const result = await readGeneratedConfiguration({
    spreadsheetId: 'authoring workbook',
    accessToken: 'short-lived-token',
    fetchImpl: async (url, init) => {
      urls.push({ url, init });
      return response({
        valueRanges: [{ values: [['{"version":1}']] }, { values: [['{"rules":[]}']] }],
      });
    },
  });

  assert.deepEqual(result, { questionnaireInput: '{"version":1}', rulesInput: '{"rules":[]}' });
  assert.deepEqual(
    urls.map(({ url }) => url),
    [
      'https://sheets.googleapis.com/v4/spreadsheets/authoring%20workbook/values:batchGet?ranges=Generated%20Questionnaire%20JSON!A2&ranges=Generated%20Rules%20JSON!A2',
    ],
  );
  assert.deepEqual(urls[0]?.init, { headers: { Authorization: 'Bearer short-lived-token' } });
});

test('rejects a missing generated workbook cell instead of validating stale configuration', async () => {
  await assert.rejects(
    () =>
      readGeneratedConfiguration({
        spreadsheetId: 'workbook',
        accessToken: 'token',
        fetchImpl: async () => response({ valueRanges: [] }),
      }),
    /Generated Questionnaire JSON!A2 is empty/,
  );
});

function temporaryProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'foodbank-takeon-'));
  const questionnairePath = join(projectRoot, 'src/features/referrals/referral-form.config.json');
  const ledgerPath = join(projectRoot, 'src/features/referrals/referral-answer-keys.frozen.ts');
  const rulesPath = join(projectRoot, 'src/features/pick-lists/preference-rules.config.json');
  mkdirSync(join(projectRoot, 'src/features/referrals'), { recursive: true });
  mkdirSync(join(projectRoot, 'src/features/pick-lists'), { recursive: true });
  writeFileSync(questionnairePath, '{"original":"questionnaire"}\n');
  writeFileSync(ledgerPath, ledger);
  writeFileSync(rulesPath, '{"original":"rules"}\n');
  return { projectRoot, questionnairePath, ledgerPath, rulesPath };
}

test('restores all three release artefacts when a focused release gate fails', () => {
  const { projectRoot, questionnairePath, ledgerPath, rulesPath } = temporaryProject();
  const original = [
    readFileSync(questionnairePath, 'utf8'),
    readFileSync(ledgerPath, 'utf8'),
    readFileSync(rulesPath, 'utf8'),
  ];
  try {
    assert.throws(
      () =>
        writeTakeon({
          questionnaire,
          rules,
          newEntries: [],
          projectRoot,
          runCommand: (_command, arguments_) => {
            if (arguments_[0] === 'vitest') throw new Error('focused configuration gate failed');
          },
        }),
      /focused configuration gate failed/,
    );
    assert.deepEqual(
      [
        readFileSync(questionnairePath, 'utf8'),
        readFileSync(ledgerPath, 'utf8'),
        readFileSync(rulesPath, 'utf8'),
      ],
      original,
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
