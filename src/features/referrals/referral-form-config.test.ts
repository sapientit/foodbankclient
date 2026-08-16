import { describe, expect, it } from 'vitest';
import rawConfig from './referral-form.config.json';
import { FROZEN_ANSWER_KEYS } from './referral-answer-keys.frozen';
import { parseReferralFormConfig, referralFormDefinition } from './referral-form-config';
import { dynamicQuestions, keyFieldQuestions } from './referral-form-definition';
import { checkDefinitionLimits, reusedKeys, unrecordedKeys } from './referral-form-guards';
import { HOUSEHOLD_COMPONENTS_KEY } from './household-composition';

/**
 * The charity's real form, checked against the guards. Everything else in this
 * feature is tested against invented fixtures; this file is the one place the
 * shipped config has to hold up, and it is the assertion that would have caught
 * a question added without a ledger entry.
 */

describe('the shipped referral form', () => {
  it('parses', () => {
    expect(referralFormDefinition.pages.length).toBeGreaterThan(0);
  });

  it('fits inside the server’s limits on the answers bag', () => {
    // Never run against a real form until now — `KNOWN-GAPS.md` said so.
    expect(checkDefinitionLimits(referralFormDefinition)).toEqual([]);
  });

  it('has every answer key recorded in the frozen ledger', () => {
    expect(unrecordedKeys(FROZEN_ANSWER_KEYS, referralFormDefinition)).toEqual([]);
  });

  it('has not reused a retired key for a different kind of question', () => {
    expect(reusedKeys(FROZEN_ANSWER_KEYS, referralFormDefinition)).toEqual([]);
  });

  /**
   * Deliberately says nothing about *which* keys are retired. It used to pin
   * the exact retired set, which meant every question the charity drops edited
   * this test — and the charity is expected to keep changing its mind about
   * what it asks. Retiring a question is now a config change and nothing else.
   *
   * **What that gives up:** deleting a line from the ledger no longer fails
   * anything. `unrecordedKeys` only checks the other direction — every live key
   * is recorded — so a removed history entry is caught by reading the diff, not
   * by this suite. The file says append-only at the top and that is now the
   * whole of the enforcement.
   */
  it('never records a typed column in the answers ledger', () => {
    // A key field in the ledger would mean a column had been treated as an
    // answer somewhere, which is the mistake the split exists to prevent.
    // Widened to `string` deliberately: a ledger entry's key is free text, and
    // the whole question is whether one of them has come to equal a column name
    // at runtime — which the narrower union type would refuse to even ask.
    const columns = new Set<string>(keyFieldQuestions(referralFormDefinition).map((q) => q.field));

    expect(FROZEN_ANSWER_KEYS.filter((entry) => columns.has(entry.key))).toEqual([]);
  });

  it('asks for every typed column the submission needs', () => {
    const asked = new Set(keyFieldQuestions(referralFormDefinition).map((q) => q.field));

    for (const required of [
      'referrerName',
      'referrerEmail',
      'referrerOrganisation',
      'referrerPhone',
      'refereeFirstName',
      'refereeSurname',
      'refereeDateOfBirth',
      'refereeAddress',
      'refereePostcode',
      'sessionId',
      'reasonId',
    ]) {
      expect(asked).toContain(required);
    }
    expect(dynamicQuestions(referralFormDefinition).map((question) => question.key)).toContain(
      HOUSEHOLD_COMPONENTS_KEY,
    );
  });

  it('asks for each typed column exactly once', () => {
    // Two questions writing one column is two ways for it to end up empty.
    const fields = keyFieldQuestions(referralFormDefinition).map((q) => q.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('marks the preference questions the pick list is adjusted from', () => {
    const preferences = dynamicQuestions(referralFormDefinition)
      .filter((question) => question.preference)
      .map((question) => question.key);

    expect(preferences).toContain('Allergies');
    expect(preferences).toContain('Toiletries');
    expect(preferences).not.toContain('Cause Details');
  });
});

describe('parseReferralFormConfig', () => {
  function withQuestion(question: unknown): unknown {
    return { version: 1, pages: [{ pageNum: 1, pageTitle: 'Page', questions: [question] }] };
  }

  const choice = {
    questionNum: 1,
    questionKey: 'Eggs',
    questionTitle: 'Eggs?',
    preference: true,
    required: false,
    validation: { type: 'CheckBox', answerMin: 0, answerMax: 1 },
    answers: ['Yes'],
  };

  it('accepts the config that ships', () => {
    expect(() => parseReferralFormConfig(rawConfig)).not.toThrow();
  });

  it('accepts a display-only No Answer row without an answer key', () => {
    expect(
      parseReferralFormConfig(
        withQuestion({
          questionNum: 1,
          questionTitle: 'Delivery is restricted to eligible households.',
          answerFormat: 'No Answer',
        }),
      ).pages[0]?.questions[0],
    ).toMatchObject({
      type: 'information',
      label: 'Delivery is restricted to eligible households.',
    });
  });

  it('retains the Sheet marker that permits a dynamic answer on the fuel screen', () => {
    const definition = parseReferralFormConfig(
      withQuestion({
        ...choice,
        forFuelTeam: true,
      }),
    );

    expect(definition.pages[0]?.questions[0]).toMatchObject({ forFuelTeam: true });
  });

  it('retains a short label for saved pick-list information', () => {
    const definition = parseReferralFormConfig(
      withQuestion({ ...choice, pickListInformation: 'Yes' }),
    );

    expect(definition.pages[0]?.questions[0]).toMatchObject({ pickListInformation: true });
  });

  it('rejects pick-list information on a non-preference question', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({ ...choice, preference: false, pickListInformation: 'Yes' }),
      ),
    ).toThrow(/pick-list information, so it must be a preference question/);
  });

  it('rejects configured information that could exceed the parcel note limit', () => {
    expect(() =>
      parseReferralFormConfig({
        version: 1,
        pages: [
          {
            pageNum: 1,
            pageTitle: 'Page',
            questions: [
              {
                ...choice,
                questionKey: 'First',
                pickListInformation: 'Yes',
                validation: { type: 'String', maxLength: 700 },
              },
              {
                ...choice,
                questionNum: 2,
                questionKey: 'Second',
                pickListInformation: 'Yes',
                validation: { type: 'String', maxLength: 700 },
              },
            ],
          },
        ],
      }),
    ).toThrow(/Pick-list information can be at most 1200 characters/);
  });

  it('refuses a household composition question under a different key', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          questionNum: 1,
          questionKey: 'A different key',
          questionTitle: 'Household',
          preference: false,
          required: true,
          validation: { type: 'HouseholdComposition' },
        }),
      ),
    ).toThrow(/household-composition question key/);
  });

  it('refuses a default that is not one of the offered answers', () => {
    expect(() => parseReferralFormConfig(withQuestion({ ...choice, default: ['Maybe'] }))).toThrow(
      /not one of its answers/,
    );
  });

  it('refuses more defaults than the question allows', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          ...choice,
          answers: ['A', 'B'],
          validation: { type: 'CheckBox', answerMin: 0, answerMax: 1 },
          default: ['A', 'B'],
        }),
      ),
    ).toThrow(/more answers than/);
  });

  it('refuses a choice with nothing to choose from', () => {
    const { answers: _answers, ...withoutAnswers } = choice;
    expect(() => parseReferralFormConfig(withQuestion(withoutAnswers))).toThrow(
      /nothing to choose from/,
    );
  });

  it('refuses a runtime option list with no declared maxAnswerLength', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          ...choice,
          answers: undefined,
          validation: {
            type: 'CheckBox',
            answerMin: 0,
            answerMax: 1,
            optionsFrom: 'referralReasons',
          },
        }),
      ),
    ).toThrow(/maxAnswerLength/);
  });

  it('refuses two questions sharing a key', () => {
    expect(() =>
      parseReferralFormConfig({
        version: 1,
        pages: [{ pageNum: 1, pageTitle: 'Page', questions: [choice, choice] }],
      }),
    ).toThrow(/share the key/);
  });

  it('refuses a condition naming a question that does not exist', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          ...choice,
          enabledWhen: { questionKey: 'nothingLikeThis', hasAnswer: 'Yes' },
        }),
      ),
    ).toThrow(/not a question on this form/);
  });

  it('refuses a chain of conditions, which `isEnabled` deliberately cannot follow', () => {
    expect(() =>
      parseReferralFormConfig({
        version: 1,
        pages: [
          {
            pageNum: 1,
            pageTitle: 'Page',
            questions: [
              {
                ...choice,
                questionKey: 'first',
                enabledWhen: { questionKey: 'second', hasAnswer: 'Yes' },
              },
              {
                ...choice,
                questionKey: 'second',
                enabledWhen: { questionKey: 'first', hasAnswer: 'Yes' },
              },
            ],
          },
        ],
      }),
    ).toThrow(/itself conditional/);
  });

  it('refuses answers on a question that is not a choice', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          questionNum: 1,
          questionKey: 'notes',
          questionTitle: 'Notes',
          preference: false,
          required: false,
          validation: { type: 'String', maxLength: 100 },
          answers: ['Yes'],
        }),
      ),
    ).toThrow(/cannot offer answers/);
  });

  it('refuses a key field this client does not have a column for', () => {
    expect(() =>
      parseReferralFormConfig(
        withQuestion({
          questionNum: 1,
          questionKey: 'inventedColumn',
          questionTitle: 'Invented',
          keyField: 'inventedColumn',
          required: true,
        }),
      ),
    ).toThrow();
  });
});
