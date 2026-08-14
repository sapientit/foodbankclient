import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendFrozenEntries,
  dynamicQuestionEntries,
  newFrozenEntries,
  parseFrozenAnswerKeys,
} from './import-questionnaire.mjs';

test('identifies only dynamic questions and their frozen types', () => {
  assert.deepEqual(
    dynamicQuestionEntries({
      pages: [
        {
          questions: [
            { questionKey: 'A text answer', validation: { type: 'String' } },
            { questionKey: 'A choice', validation: { type: 'CheckBox' } },
            { questionKey: 'refereePhone', keyField: 'refereePhone' },
            { questionTitle: 'Display-only information' },
          ],
        },
      ],
    }),
    [
      { key: 'A text answer', type: 'text' },
      { key: 'A choice', type: 'choice' },
    ],
  );
});

test('refuses a released key whose answer type changes', () => {
  assert.throws(
    () =>
      newFrozenEntries(
        [{ key: 'Previously text', type: 'choice' }],
        new Map([['Previously text', 'text']]),
      ),
    /released as text, not choice/,
  );
});

test('appends only genuinely new dynamic answer keys to the ledger', () => {
  const source = "export const FROZEN_ANSWER_KEYS = [\n  { key: 'Existing', type: 'text' },\n];\n";
  const frozen = parseFrozenAnswerKeys(source);
  const entries = newFrozenEntries(
    [
      { key: 'Existing', type: 'text' },
      { key: "New answer's key", type: 'choice' },
    ],
    frozen,
  );

  assert.deepEqual(entries, [{ key: "New answer's key", type: 'choice' }]);
  assert.match(appendFrozenEntries(source, entries), /New answer\\'s key/);
});

test('rejects duplicate entries in the frozen ledger', () => {
  assert.throws(
    () =>
      parseFrozenAnswerKeys(
        "export const FROZEN_ANSWER_KEYS = [\n  { key: 'Duplicate', type: 'text' },\n  { key: 'Duplicate', type: 'choice' },\n];\n",
      ),
    /records "Duplicate" more than once/,
  );
});
