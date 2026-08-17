import { describe, expect, it } from 'vitest';
import { describeAnswers, type ReferralAnswersSource } from './referral-answers.logic';
import type { ReferralFormDefinition } from './referral-form-definition';

/* Fixtures invented for this file only — never the real `referral-form.config.json`. */

const definition: ReferralFormDefinition = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Page',
      questions: [
        {
          key: 'notes',
          type: 'text',
          label: 'Notes',
          required: false,
          preference: false,
          maxLength: 200,
        },
        { key: 'pets', type: 'number', label: 'Number of pets', required: false, preference: true },
        {
          key: 'contact',
          type: 'choice',
          label: 'Preferred contact method',
          required: false,
          preference: false,
          answerMin: 0,
          answerMax: 1,
          options: [
            { value: 'phone', label: 'Phone' },
            { value: 'email', label: 'Email' },
          ],
        },
        {
          key: 'Toiletries',
          type: 'choice',
          label: 'Toiletries',
          required: false,
          preference: true,
          answerMin: 0,
          answerMax: 3,
          options: [
            { value: 'Shower Gel', label: 'Shower Gel' },
            { value: 'Deodorant', label: 'Deodorant' },
          ],
        },
        {
          key: 'Secondary',
          type: 'choice',
          label: 'Secondary cause of crisis',
          required: false,
          preference: false,
          answerMin: 0,
          answerMax: 1,
          options: [],
          optionsFrom: 'referralReasons',
          maxAnswerLength: 200,
        },
        {
          key: 'adults',
          type: 'keyField',
          field: 'adults',
          label: 'Number of adults',
          required: true,
        },
      ],
    },
  ],
};

function referral(overrides: Partial<ReferralAnswersSource>): ReferralAnswersSource {
  return { answers: {}, piiPurgedAt: null, ...overrides };
}

describe('describeAnswers', () => {
  it('reads a purged referral as purged, not as an empty screen', () => {
    const result = describeAnswers(
      definition,
      referral({ piiPurgedAt: '2026-08-01T00:00:00.000Z' }),
      {},
    );
    expect(result).toEqual({ kind: 'purged' });
  });

  it('reports no answers at all when the bag is genuinely empty and nothing was purged', () => {
    expect(describeAnswers(definition, referral({ answers: {} }), {})).toEqual({
      kind: 'no-answers',
    });
  });

  it('renders a known text answer under its label', () => {
    expect(
      describeAnswers(definition, referral({ answers: { notes: 'No nuts please' } }), {}),
    ).toEqual({
      kind: 'answers',
      lines: [
        {
          key: 'notes',
          label: 'Notes',
          value: 'No nuts please',
          isUnknownKey: false,
          isPreference: false,
        },
      ],
    });
  });

  it('marks a preference answer as one, so the pick-list screen can show only those', () => {
    const result = describeAnswers(definition, referral({ answers: { pets: 2, notes: 'x' } }), {});
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines.find((line) => line.key === 'pets')?.isPreference).toBe(true);
    expect(result.lines.find((line) => line.key === 'notes')?.isPreference).toBe(false);
  });

  it('renders a single-answer choice stored as a bare string, by its label', () => {
    expect(describeAnswers(definition, referral({ answers: { contact: 'phone' } }), {})).toEqual({
      kind: 'answers',
      lines: [
        {
          key: 'contact',
          label: 'Preferred contact method',
          value: 'Phone',
          isUnknownKey: false,
          isPreference: false,
        },
      ],
    });
  });

  it('renders a multi-answer choice as its labels, comma separated', () => {
    const result = describeAnswers(
      definition,
      referral({ answers: { Toiletries: ['Shower Gel', 'Deodorant'] } }),
      {},
    );
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]?.value).toBe('Shower Gel, Deodorant');
  });

  it('still renders a choice value the current option list no longer offers', () => {
    // The option list can change between releases; an old answer must not
    // vanish just because the choice it names is gone.
    const result = describeAnswers(
      definition,
      referral({ answers: { contact: 'carrier-pigeon' } }),
      {},
    );
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]?.value).toBe('carrier-pigeon (no longer offered)');
  });

  it('reads an answer chosen from a server lookup as the words, never the stored id', () => {
    // The reason list is maintained on the server, so this question stores the
    // reason's id. Nobody — administrator, team lead or listener — may be shown
    // that id, which is why the lookup is an argument rather than an option.
    const result = describeAnswers(
      definition,
      referral({ answers: { Secondary: 'reason-debt' } }),
      {
        referralReasons: [{ value: 'reason-debt', label: 'Debt' }],
      },
    );
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]?.value).toBe('Debt');
  });

  it('withholds the id rather than printing it when the lookup cannot name it', () => {
    // A reason retired since the referral was made is absent from the public
    // list, which is the only one a team lead may read. Q37 in the server's
    // OPEN-QUESTIONS.md — the wording is a guess, the id being withheld is not.
    const result = describeAnswers(
      definition,
      referral({ answers: { Secondary: 'reason-gone' } }),
      {
        referralReasons: [{ value: 'reason-debt', label: 'Debt' }],
      },
    );
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]?.value).toBe('No longer listed');
    expect(result.lines[0]?.value).not.toContain('reason-gone');
  });

  it('renders a key the current definition does not know, rather than dropping it', () => {
    // A referral captured under an older form version — CLAUDE.md: "Unknown
    // keys are stored, not dropped."
    expect(
      describeAnswers(definition, referral({ answers: { retiredQuestion: 'some answer' } }), {}),
    ).toEqual({
      kind: 'answers',
      lines: [
        {
          key: 'retiredQuestion',
          label: 'retiredQuestion',
          value: 'some answer',
          isUnknownKey: true,
          isPreference: false,
        },
      ],
    });
  });

  it('treats a key that is now a typed column as unknown, because it is not an answers key', () => {
    // An older form stored an answer under a name that has since become a
    // column. Showing it raw is honest; showing it under the column's label
    // would claim the two are the same thing.
    const result = describeAnswers(definition, referral({ answers: { adults: 4 } }), {});
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]).toEqual({
      key: 'adults',
      label: 'adults',
      value: '4',
      isUnknownKey: true,
      isPreference: false,
    });
  });

  it('mixes known and unknown keys in one referral without losing either', () => {
    const result = describeAnswers(
      definition,
      referral({ answers: { notes: 'Fine', oldKey: 'legacy value' } }),
      {},
    );
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines).toHaveLength(2);
    expect(result.lines.some((line) => line.key === 'notes' && !line.isUnknownKey)).toBe(true);
    expect(result.lines.some((line) => line.key === 'oldKey' && line.isUnknownKey)).toBe(true);
  });

  it('falls back to a readable string for a value that does not match its known type', () => {
    // The server never validated this — a bug in an earlier client, or a
    // hand-edited row, could leave a number question holding a string.
    const result = describeAnswers(definition, referral({ answers: { pets: 'two' } }), {});
    if (result.kind !== 'answers') throw new Error('unreachable');

    expect(result.lines[0]?.value).toBe('two');
  });
});
