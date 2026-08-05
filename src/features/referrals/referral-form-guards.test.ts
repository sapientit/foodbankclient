import { describe, expect, it } from 'vitest';
import type { FormQuestion, ReferralFormDefinition } from './referral-form-definition';
import {
  MAX_ANSWER_KEYS,
  MAX_ANSWER_KEY_LENGTH,
  checkDefinitionLimits,
  reusedKeys,
  unrecordedKeys,
  type FrozenAnswerKey,
} from './referral-form-guards';

/*
 * Every fixture here is invented for this file only. These prove what the
 * guards do; `referral-form-config.test.ts` is where they are pointed at the
 * charity's real form.
 */

function form(...questions: FormQuestion[]): ReferralFormDefinition {
  return { version: 1, pages: [{ pageNum: 1, pageTitle: 'Page', questions }] };
}

describe('checkDefinitionLimits', () => {
  it('accepts a small, well-formed definition', () => {
    const definition = form(
      {
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 200,
      },
      {
        key: 'pets',
        type: 'number',
        label: 'Pets',
        required: false,
        preference: false,
        minimum: 0,
        maximum: 20,
      },
    );

    expect(checkDefinitionLimits(definition)).toEqual([]);
  });

  it('ignores key fields, which are typed columns rather than answers', () => {
    // None of the server's limits on the `answers` bag apply to a column, so a
    // form of nothing but key fields has nothing to check.
    const definition = form(
      {
        key: 'refereeAddress',
        type: 'keyField',
        field: 'refereeAddress',
        label: 'Address',
        required: true,
      },
      { key: 'adults', type: 'keyField', field: 'adults', label: 'Adults', required: true },
    );

    expect(checkDefinitionLimits(definition)).toEqual([]);
  });

  it('flags two questions sharing a key', () => {
    const definition = form(
      {
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 200,
      },
      {
        key: 'notes',
        type: 'text',
        label: 'More notes',
        required: false,
        preference: false,
        maxLength: 200,
      },
    );

    expect(checkDefinitionLimits(definition)).toContainEqual({
      type: 'duplicate-key',
      key: 'notes',
    });
  });

  it('flags a key over sixty characters, the server storage limit', () => {
    const longKey = 'x'.repeat(MAX_ANSWER_KEY_LENGTH + 1);
    const definition = form({
      key: longKey,
      type: 'text',
      label: 'Notes',
      required: false,
      preference: false,
      maxLength: 10,
    });

    expect(checkDefinitionLimits(definition)).toContainEqual({
      type: 'key-too-long',
      key: longKey,
    });
  });

  it('flags more than a hundred questions, the server storage limit', () => {
    const definition = form(
      ...Array.from({ length: MAX_ANSWER_KEYS + 1 }, (_, i) => ({
        key: `q${String(i)}`,
        type: 'text' as const,
        label: `Question ${String(i)}`,
        required: false,
        preference: false,
        maxLength: 10,
      })),
    );

    expect(checkDefinitionLimits(definition)).toContainEqual({
      type: 'too-many-questions',
      count: MAX_ANSWER_KEYS + 1,
    });
  });

  it('flags a definition whose worst case would breach the 16KB serialised limit', () => {
    const definition = form({
      key: 'essay',
      type: 'text',
      label: 'Tell us everything',
      required: false,
      preference: false,
      maxLength: 20_000,
    });

    expect(checkDefinitionLimits(definition).some((p) => p.type === 'answers-too-large')).toBe(
      true,
    );
  });

  it('estimates a choice by its longest option value, not its label', () => {
    // Only the `value` is ever stored on a referral; the `label` never is. A
    // huge label with a short value must not trip the size guard — if it did,
    // the estimate would be reading the wrong field.
    const definition = form({
      key: 'choice',
      type: 'choice',
      label: 'Choice',
      required: false,
      preference: false,
      answerMin: 0,
      answerMax: 1,
      options: [
        { value: 'a', label: 'x'.repeat(20_000) },
        { value: 'b', label: 'short' },
      ],
    });

    expect(checkDefinitionLimits(definition)).toEqual([]);
  });

  it('sizes a multi-answer choice by how many answers it allows, not by one', () => {
    // Three answers of a thousand characters is three thousand characters on
    // the wire. Sizing it as one would let a form through that the server
    // rejects only once a referrer has filled it in.
    const wide = (answerMax: number): ReferralFormDefinition =>
      form({
        key: 'many',
        type: 'choice',
        label: 'Many',
        required: false,
        preference: false,
        answerMin: 0,
        answerMax,
        options: Array.from({ length: 20 }, (_, i) => ({
          value: `${String(i)}${'x'.repeat(1_000)}`,
          label: 'short',
        })),
      });

    expect(checkDefinitionLimits(wide(3))).toEqual([]);
    expect(checkDefinitionLimits(wide(20)).some((p) => p.type === 'answers-too-large')).toBe(true);
  });

  it('sizes a runtime option list by its declared maxAnswerLength', () => {
    // The options arrive from the server, so there is nothing here to measure;
    // the declared bound is what keeps the 16KB check arithmetic.
    const definition = form({
      key: 'Secondary',
      type: 'choice',
      label: 'Secondary cause',
      required: false,
      preference: false,
      answerMin: 0,
      answerMax: 1,
      options: [],
      optionsFrom: 'referralReasons',
      maxAnswerLength: 20_000,
    });

    expect(checkDefinitionLimits(definition).some((p) => p.type === 'answers-too-large')).toBe(
      true,
    );
  });
});

describe('reusedKeys', () => {
  const history: readonly FrozenAnswerKey[] = [
    { key: 'notes', type: 'text' },
    { key: 'pets', type: 'number' },
  ];

  it('finds nothing wrong when every current key still matches its frozen type', () => {
    const definition = form(
      {
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 200,
      },
      { key: 'pets', type: 'number', label: 'Pets', required: false, preference: false },
    );

    expect(reusedKeys(history, definition)).toEqual([]);
  });

  it('does not flag a question dropped from the live definition', () => {
    const definition = form({
      key: 'notes',
      type: 'text',
      label: 'Notes',
      required: false,
      preference: false,
      maxLength: 200,
    });

    // "pets" is retired, not reused — the ledger keeps it, nothing here fires.
    expect(reusedKeys(history, definition)).toEqual([]);
  });

  it('flags a retired key reused under a different type as a different question', () => {
    const definition = form({
      key: 'pets',
      type: 'choice',
      label: 'Preferred contact method',
      required: false,
      preference: false,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'phone', label: 'Phone' }],
    });

    expect(reusedKeys(history, definition)).toEqual(['pets']);
  });

  it('does not flag a brand new key with no history at all', () => {
    const definition = form({
      key: 'brandNew',
      type: 'text',
      label: 'Something new',
      required: false,
      preference: false,
      maxLength: 100,
    });

    // A new key is `unrecordedKeys`'s job to catch, not this one's.
    expect(reusedKeys(history, definition)).toEqual([]);
  });
});

describe('unrecordedKeys', () => {
  const history: readonly FrozenAnswerKey[] = [{ key: 'notes', type: 'text' }];

  it('finds nothing when every live key has a history entry', () => {
    const definition = form({
      key: 'notes',
      type: 'text',
      label: 'Notes',
      required: false,
      preference: false,
      maxLength: 200,
    });

    expect(unrecordedKeys(history, definition)).toEqual([]);
  });

  it('catches a question shipped without being added to the ledger', () => {
    const definition = form(
      {
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 200,
      },
      {
        key: 'newQuestion',
        type: 'text',
        label: 'New',
        required: false,
        preference: false,
        maxLength: 100,
      },
    );

    expect(unrecordedKeys(history, definition)).toEqual(['newQuestion']);
  });

  it('never asks for a key field, which has no answers key to freeze', () => {
    const definition = form({
      key: 'adults',
      type: 'keyField',
      field: 'adults',
      label: 'Adults',
      required: true,
    });

    expect(unrecordedKeys([], definition)).toEqual([]);
  });
});
