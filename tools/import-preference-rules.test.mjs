import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  importPreferenceRules,
  parsePreferenceRuleConfig,
  validatePreferenceRuleReferences,
} from './import-preference-rules.mjs';

const ORIGINAL_CONFIG = '{\n  "rules": []\n}\n';
const VALID_RULES = {
  rules: [
    {
      when: { key: 'Household' },
      otherwise: { set: [{ stock: 'Detergent', quantity: 1 }] },
    },
  ],
};

const REFERRAL_FORM_WITH_PREFERENCE = {
  pages: [
    {
      questions: [
        {
          questionKey: 'Household',
          preference: true,
          validation: { type: 'CheckBox' },
          answers: ['Detergent', 'Bleach'],
        },
      ],
    },
  ],
};

function temporaryProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'foodbank-preference-rules-'));
  const configPath = join(projectRoot, 'src/features/pick-lists/preference-rules.config.json');
  const referralFormPath = join(projectRoot, 'src/features/referrals/referral-form.config.json');
  mkdirSync(join(projectRoot, 'src/features/pick-lists'), { recursive: true });
  mkdirSync(join(projectRoot, 'src/features/referrals'), { recursive: true });
  writeFileSync(configPath, ORIGINAL_CONFIG);
  writeFileSync(referralFormPath, JSON.stringify(REFERRAL_FORM_WITH_PREFERENCE));
  return { projectRoot, configPath };
}

test('refuses malformed rules before replacing the released configuration', () => {
  const { projectRoot, configPath } = temporaryProject();
  try {
    assert.throws(
      () => importPreferenceRules({ input: '{"rules": [}', projectRoot }),
      /preference rules are invalid/i,
    );
    assert.equal(readFileSync(configPath, 'utf8'), ORIGINAL_CONFIG);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('refuses schema-invalid rules before replacing the released configuration', () => {
  const { projectRoot, configPath } = temporaryProject();
  try {
    assert.throws(
      () =>
        importPreferenceRules({
          input: JSON.stringify({ rules: [{ when: { key: 'Household' }, cases: [] }] }),
          projectRoot,
        }),
      /with cases needs otherwise/,
    );
    assert.equal(readFileSync(configPath, 'utf8'), ORIGINAL_CONFIG);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('refuses rules that use $selectedAnswer as an answer trigger', () => {
  assert.throws(
    () =>
      parsePreferenceRuleConfig({
        rules: [
          {
            when: { key: 'Household', hasAnswer: '$selectedAnswer' },
            otherwise: { set: [{ stock: 'Detergent', quantity: 1 }] },
          },
        ],
      }),
    /only as a stock item/,
  );
});

test('rejects a rule that references an unknown preference question', () => {
  assert.deepEqual(
    validatePreferenceRuleReferences(
      {
        rules: [
          {
            when: { key: 'Unknown preference' },
            otherwise: { set: [{ stock: 'Detergent', quantity: 1 }] },
          },
        ],
      },
      REFERRAL_FORM_WITH_PREFERENCE,
    ),
    ['Rule Unknown preference: the preference question does not exist.'],
  );
});

test('rejects a fixed answer that the preference question does not offer', () => {
  assert.deepEqual(
    validatePreferenceRuleReferences(
      {
        rules: [
          {
            when: { key: 'Household', hasAnswer: 'Wipes' },
            otherwise: { set: [{ stock: 'Detergent', quantity: 1 }] },
          },
        ],
      },
      REFERRAL_FORM_WITH_PREFERENCE,
    ),
    ['Rule Household: Wipes is not an offered answer.'],
  );
});

test('writes reviewed rules only after their local release gates pass', () => {
  const { projectRoot, configPath } = temporaryProject();
  const commands = [];
  try {
    importPreferenceRules({
      input: JSON.stringify(VALID_RULES),
      projectRoot,
      runCommand: (command, arguments_, cwd) => commands.push({ command, arguments_, cwd }),
    });

    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), VALID_RULES);
    assert.deepEqual(commands, [
      {
        command: 'npx',
        arguments_: ['prettier', '--write', configPath],
        cwd: projectRoot,
      },
      {
        command: 'npx',
        arguments_: ['vitest', 'run', 'src/features/pick-lists/preference-rules.config.test.ts'],
        cwd: projectRoot,
      },
    ]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('restores the released configuration when a local release gate fails', () => {
  const { projectRoot, configPath } = temporaryProject();
  try {
    assert.throws(
      () =>
        importPreferenceRules({
          input: JSON.stringify(VALID_RULES),
          projectRoot,
          runCommand: (_command, arguments_) => {
            if (arguments_[0] === 'vitest') throw new Error('focused validation failed');
          },
        }),
      /focused validation failed/,
    );
    assert.equal(readFileSync(configPath, 'utf8'), ORIGINAL_CONFIG);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
