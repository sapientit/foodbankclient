import { describe, expect, it } from 'vitest';
import type { FormQuestion, ReferralFormDefinition } from './referral-form-definition';
import {
  buildFormSchema,
  buildPageSchema,
  defaultAnswers,
  parseIntegerAnswer,
} from './referral-form-schema';

/* Fixtures invented for this file only — never the real `referral-form.config.json`. */

function form(...questions: FormQuestion[]): ReferralFormDefinition {
  return { version: 1, pages: [{ pageNum: 1, pageTitle: 'Page', questions }] };
}

describe('buildFormSchema, text questions', () => {
  it('requires a required text question and rejects a blank one', () => {
    const schema = buildFormSchema(
      form({
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: true,
        preference: false,
        maxLength: 100,
      }),
    );

    expect(schema.safeParse({ notes: '' }).success).toBe(false);
    expect(schema.safeParse({ notes: 'Fine' }).success).toBe(true);
  });

  it('allows an optional text question left blank', () => {
    const schema = buildFormSchema(
      form({
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 100,
      }),
    );

    expect(schema.safeParse({ notes: '' }).success).toBe(true);
  });

  it('rejects text over its declared maxLength', () => {
    const schema = buildFormSchema(
      form({
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 5,
      }),
    );

    expect(schema.safeParse({ notes: 'this is far too long' }).success).toBe(false);
    expect(schema.safeParse({ notes: 'short' }).success).toBe(true);
  });
});

describe('buildFormSchema, number questions', () => {
  it('rejects a non-whole-number answer', () => {
    const schema = buildFormSchema(
      form({ key: 'pets', type: 'number', label: 'Pets', required: true, preference: false }),
    );

    expect(schema.safeParse({ pets: 'two' }).success).toBe(false);
    expect(schema.safeParse({ pets: '2.5' }).success).toBe(false);
    expect(schema.safeParse({ pets: '2' }).success).toBe(true);
  });

  it('enforces the declared bounds', () => {
    const schema = buildFormSchema(
      form({
        key: 'pets',
        type: 'number',
        label: 'Pets',
        required: false,
        preference: false,
        minimum: 0,
        maximum: 10,
      }),
    );

    expect(schema.safeParse({ pets: '-1' }).success).toBe(false);
    expect(schema.safeParse({ pets: '11' }).success).toBe(false);
    expect(schema.safeParse({ pets: '10' }).success).toBe(true);
  });

  it('leaves an optional blank box alone', () => {
    const schema = buildFormSchema(
      form({
        key: 'pets',
        type: 'number',
        label: 'Pets',
        required: false,
        preference: false,
        minimum: 0,
      }),
    );

    expect(schema.safeParse({ pets: '' }).success).toBe(true);
  });
});

describe('buildFormSchema, choice questions', () => {
  const eggs: FormQuestion = {
    key: 'Eggs',
    type: 'choice',
    label: 'Would they like eggs?',
    required: false,
    preference: true,
    answerMin: 0,
    answerMax: 1,
    options: [{ value: 'Yes', label: 'Yes' }],
  };

  it('accepts an empty selection when the question offers None', () => {
    // "None" is how an empty selection renders, so it has to be valid — a
    // household that wants no eggs is not a form somebody failed to fill in.
    expect(buildFormSchema(form(eggs)).safeParse({ Eggs: [] }).success).toBe(true);
  });

  it('rejects an empty selection when at least one answer is demanded', () => {
    const schema = buildFormSchema(form({ ...eggs, answerMin: 1 }));

    expect(schema.safeParse({ Eggs: [] }).success).toBe(false);
    expect(schema.safeParse({ Eggs: ['Yes'] }).success).toBe(true);
  });

  it('rejects more answers than the question allows', () => {
    const schema = buildFormSchema(
      form({
        key: 'Toiletries',
        type: 'choice',
        label: 'Toiletries',
        required: false,
        preference: true,
        answerMin: 0,
        answerMax: 3,
        options: ['A', 'B', 'C', 'D'].map((value) => ({ value, label: value })),
      }),
    );

    expect(schema.safeParse({ Toiletries: ['A', 'B', 'C'] }).success).toBe(true);
    expect(schema.safeParse({ Toiletries: ['A', 'B', 'C', 'D'] }).success).toBe(false);
  });

  it('accepts only the declared option values', () => {
    const schema = buildFormSchema(form(eggs));

    expect(schema.safeParse({ Eggs: ['Yes'] }).success).toBe(true);
    expect(schema.safeParse({ Eggs: ['Maybe'] }).success).toBe(false);
  });

  it('does not check the values of a question whose options arrive at runtime', () => {
    // The renderer can only offer what the server gave it, and a stale id is a
    // `422` whose message is written to be shown.
    const schema = buildFormSchema(
      form({
        key: 'Secondary',
        type: 'choice',
        label: 'Secondary cause',
        required: false,
        preference: false,
        answerMin: 0,
        answerMax: 1,
        options: [],
        optionsFrom: 'referralReasons',
        maxAnswerLength: 120,
      }),
    );

    expect(schema.safeParse({ Secondary: ['whatever-the-server-said'] }).success).toBe(true);
  });
});

describe('buildFormSchema, key fields', () => {
  const postcode: FormQuestion = {
    key: 'refereePostcode',
    type: 'keyField',
    field: 'refereePostcode',
    label: "Client's postcode",
    required: true,
  };

  it('validates a key field by its column, not by anything the config said', () => {
    const schema = buildFormSchema(form(postcode));

    expect(schema.safeParse({ refereePostcode: 'gu234xx' }).success).toBe(true);
    expect(schema.safeParse({ refereePostcode: 'Guildford' }).success).toBe(false);
  });

  it('rejects a blank required key field and allows a blank optional one', () => {
    expect(buildFormSchema(form(postcode)).safeParse({ refereePostcode: '' }).success).toBe(false);
    expect(
      buildFormSchema(form({ ...postcode, required: false })).safeParse({ refereePostcode: '' })
        .success,
    ).toBe(true);
  });
});

describe('buildFormSchema', () => {
  it('rejects a key the definition does not describe', () => {
    const schema = buildFormSchema(
      form({
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 100,
      }),
    );

    expect(schema.safeParse({ notes: 'fine', somethingElse: 'x' }).success).toBe(false);
  });
});

describe('buildPageSchema', () => {
  it('validates only its own page, so a blank box on page two does not block page one', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'One',
          questions: [
            {
              key: 'a',
              type: 'text',
              label: 'A',
              required: false,
              preference: false,
              maxLength: 10,
            },
          ],
        },
        {
          pageNum: 2,
          pageTitle: 'Two',
          questions: [
            {
              key: 'b',
              type: 'text',
              label: 'B',
              required: true,
              preference: false,
              maxLength: 10,
            },
          ],
        },
      ],
    };

    const [first] = definition.pages;
    expect(first).toBeDefined();
    expect(buildPageSchema(first!).safeParse({ a: '' }).success).toBe(true);
    expect(buildFormSchema(definition).safeParse({ a: '', b: '' }).success).toBe(false);
  });
});

describe('defaultAnswers', () => {
  it('starts a choice question on its declared default and everything else empty', () => {
    const definition = form(
      {
        key: 'Pasta/Rice',
        type: 'choice',
        label: 'Pasta or rice?',
        required: false,
        preference: true,
        answerMin: 0,
        answerMax: 1,
        options: [
          { value: 'Pasta', label: 'Pasta' },
          { value: 'Both', label: 'Both' },
        ],
        default: ['Both'],
      },
      {
        key: 'notes',
        type: 'text',
        label: 'Notes',
        required: false,
        preference: false,
        maxLength: 10,
      },
    );

    expect(defaultAnswers(definition)).toEqual({ 'Pasta/Rice': ['Both'], notes: '' });
  });

  it('starts a choice with no declared default on None, which is an empty selection', () => {
    const definition = form({
      key: 'Porridge',
      type: 'choice',
      label: 'Porridge?',
      required: false,
      preference: true,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
    });

    expect(defaultAnswers(definition)).toEqual({ Porridge: [] });
  });

  it('gives every field a value, so no control starts uncontrolled', () => {
    const definition = form({
      key: 'adults',
      type: 'keyField',
      field: 'adults',
      label: 'Adults',
      required: true,
    });

    expect(defaultAnswers(definition)).toEqual({ adults: '' });
  });
});

describe('parseIntegerAnswer', () => {
  it('accepts a negative whole number when no minimum forbids it', () => {
    expect(parseIntegerAnswer('-3', {})).toEqual({ ok: true, value: -3 });
  });

  it('rejects a decimal', () => {
    expect(parseIntegerAnswer('3.5', {})).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });
});
