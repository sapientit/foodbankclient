import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadQuestionnaireScript(rows) {
  const context = {
    Map,
    Set,
    String,
    Number,
    Math,
    JSON,
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: () => ({
          getLastRow: () => rows.values.length + 5,
          getRange: (row) => ({
            getDisplayValues: () => (row === 5 ? [rows.headers] : rows.values),
          }),
        }),
      }),
    },
  };
  vm.createContext(context);
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'questionnaire.gs'),
    'utf8',
  );
  vm.runInContext(
    `${source}\nglobalThis.questionnaireTest = { parseQuestionnaire_, toClientConfig_ };`,
    context,
  );
  return context.questionnaireTest;
}

test('preserves the For Listener Sheet marker in generated questionnaire JSON', () => {
  const headers = [
    'Page',
    'Question key',
    'Question wording',
    'Answer format',
    'Selection',
    'Required',
    'Use for picking rules?',
    'Answer / option shown',
    'Default?',
    'Shown when key',
    'Shown when answer',
    'Pick-list information',
    'For Fuel Team',
    'For Listener Sheet',
  ];
  const { parseQuestionnaire_, toClientConfig_ } = loadQuestionnaireScript({
    headers,
    values: [
      [
        '1 — Client details',
        'listener note',
        'What should the listener know?',
        'Text',
        '',
        'No',
        'No',
        '',
        '',
        '',
        '',
        '',
        'No',
        'Yes',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0);
  assert.equal(converted.json.pages[0].questions[0].forListenerSheet, true);
});

test('converts exact and ranged selection limits from the questionnaire sheet', () => {
  const headers = [
    'Page',
    'Question key',
    'Question wording',
    'Answer format',
    'Selection',
    'Required',
    'Use for picking rules?',
    'Answer / option shown',
    'Default?',
    'Shown when key',
    'Shown when answer',
    'Pick-list information',
    'For Fuel Team',
    'For Listener Sheet',
  ];
  const { parseQuestionnaire_ } = loadQuestionnaireScript({
    headers,
    values: [
      [
        '1 — Preferences',
        'exact choice',
        'Choose exactly two',
        'Choice list',
        'Choose 2',
        'Yes',
        'No',
        'First',
        '',
        '',
        '',
        '',
        'No',
        'No',
      ],
      ['', '', '', '', '', '', '', 'Second', '', '', '', '', '', ''],
      [
        '1 — Preferences',
        'range choice',
        'Choose one or two',
        'Choice list',
        'Choose 1-2',
        'Yes',
        'No',
        'First',
        '',
        '',
        '',
        '',
        'No',
        'No',
      ],
      ['', '', '', '', '', '', '', 'Second', '', '', '', '', '', ''],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  assert.deepEqual(parsed.json.pages[0].questions[0].answerMin, 2);
  assert.deepEqual(parsed.json.pages[0].questions[0].answerMax, 2);
  assert.deepEqual(parsed.json.pages[0].questions[1].answerMin, 1);
  assert.deepEqual(parsed.json.pages[0].questions[1].answerMax, 2);
});
