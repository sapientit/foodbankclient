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

test('a For Listener Sheet cell other than Yes or No becomes a shortened column heading', () => {
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
        'pm okay',
        'Is it OK for the team to leave a message with someone else in the household?',
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
        'PM?',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0);
  assert.equal(converted.json.pages[0].questions[0].forListenerSheet, 'PM?');
});

test('a blank or No For Listener Sheet cell leaves the question off the sheet', () => {
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
        'not marked',
        'An ordinary question',
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
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0);
  assert.equal('forListenerSheet' in converted.json.pages[0].questions[0], false);
});

test('normalises True and False listener-sheet include and exclude markers', () => {
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
        'show with wording',
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
        ' true ',
      ],
      [
        '1 — Client details',
        'hide from listener',
        'This must not appear on the listener sheet',
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
        'FALSE',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0, converted.errors.join('\n'));
  assert.equal(converted.json.pages[0].questions[0].forListenerSheet, true);
  assert.equal('forListenerSheet' in converted.json.pages[0].questions[1], false);
});

test('allows the questionnaire to make the server-optional client phone mandatory', () => {
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
        'refereePhone',
        "Client's contact number",
        'Phone number',
        '',
        'Yes',
        'No',
        '',
        '',
        '',
        '',
        '',
        'No',
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0);
  const clientPhone = converted.json.pages[0].questions[0];
  assert.equal(clientPhone.questionKey, 'refereePhone');
  assert.equal(clientPhone.required, true);
  assert.equal(clientPhone.keyField, 'refereePhone');
});

test('converts a Yes/No preference question into a one-tick choice, defaulted as asked', () => {
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
        '1 — Preferences',
        'Porridge',
        'Would they like porridge oats?',
        'Yes / No',
        '',
        'No',
        'Yes',
        '',
        'Yes',
        '',
        '',
        '',
        'No',
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0, converted.errors.join('\n'));
  const question = converted.json.pages[0].questions[0];
  // `assert.deepEqual` on a whole object compares prototypes too, and the
  // Apps Script runs in its own vm context — same shape, different realm.
  assert.equal(question.validation.type, 'CheckBox');
  assert.equal(question.validation.answerMin, 0);
  assert.equal(question.validation.answerMax, 1);
  assert.deepEqual([...question.answers], ['Yes']);
  assert.deepEqual([...question.default], ['Yes']);
});

test('a required Yes/No question demands the tick, not just offers it', () => {
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
        '1 — Preferences',
        'Permission',
        'Do you give permission?',
        'Yes / No',
        '',
        'Yes',
        'No',
        '',
        '',
        '',
        '',
        '',
        'No',
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0, converted.errors.join('\n'));
  const question = converted.json.pages[0].questions[0];
  assert.equal(question.validation.answerMin, 1);
  assert.equal(question.validation.answerMax, 1);
  assert.equal(question.default, undefined);
});

test('refuses an authored answer option on a Yes/No question — its one answer is implicit', () => {
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
        'Eggs',
        'Would they like eggs?',
        'Yes / No',
        '',
        'No',
        'Yes',
        'Yes',
        '',
        '',
        '',
        '',
        'No',
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.match(parsed.errors.join('\n'), /implicit Yes answer/);
});

test('does not let a Yes/No fixed field pick up answers or a default meant for a dynamic question', () => {
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
        'needsFuelHelp',
        'Does the client need help with Energy costs?',
        'Yes / No',
        '',
        'No',
        'No',
        '',
        'Yes',
        '',
        '',
        '',
        'No',
        'No',
      ],
    ],
  });

  const parsed = parseQuestionnaire_();
  assert.equal(parsed.errors.length, 0, parsed.errors.join('\n'));
  const converted = toClientConfig_(parsed.json);
  assert.equal(converted.errors.length, 0, converted.errors.join('\n'));
  const question = converted.json.pages[0].questions[0];
  // Field-by-field, not a whole-object `deepEqual` — the Apps Script runs in
  // its own vm context, so a cross-realm object comparison fails on prototype
  // alone even when every field matches.
  assert.equal(question.questionKey, 'needsFuelHelp');
  assert.equal(question.keyField, 'needsFuelHelp');
  assert.equal(question.required, false);
  assert.equal(question.answers, undefined);
  assert.equal(question.default, undefined);
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
