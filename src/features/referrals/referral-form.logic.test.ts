import { describe, expect, it } from 'vitest';
import type {
  ChoiceQuestion,
  FormQuestion,
  ReferralFormDefinition,
} from './referral-form-definition';
import {
  canSelectMore,
  choiceInstruction,
  clearDisabledAnswers,
  describePageProgress,
  enabledQuestions,
  isEnabled,
  isNoneSelected,
  isYesNoChoice,
  offersNone,
  selectNone,
  toggleChoice,
} from './referral-form.logic';

function choice(overrides: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
  return {
    key: 'Toiletries',
    type: 'choice',
    label: 'Toiletries',
    required: false,
    preference: true,
    answerMin: 0,
    answerMax: 3,
    options: ['A', 'B', 'C', 'D'].map((value) => ({ value, label: value })),
    ...overrides,
  };
}

function form(...questions: FormQuestion[]): ReferralFormDefinition {
  return { version: 1, pages: [{ pageNum: 1, pageTitle: 'Page', questions }] };
}

describe('choiceInstruction', () => {
  it('has no instruction for a dropdown that allows at most one answer', () => {
    expect(choiceInstruction(choice({ answerMin: 1, answerMax: 1 }))).toBeNull();
    expect(choiceInstruction(choice({ answerMin: 0, answerMax: 1 }))).toBeNull();
  });

  it('offers None when none is allowed', () => {
    expect(choiceInstruction(choice({ answerMin: 0, answerMax: 3 }))).toBe(
      'Choose up to three, or None.',
    );
  });

  it('gives a range when both ends differ and none is not allowed', () => {
    expect(choiceInstruction(choice({ answerMin: 1, answerMax: 3 }))).toBe(
      'Choose between one and three.',
    );
  });

  it('falls back to a numeral past the counting words', () => {
    expect(choiceInstruction(choice({ answerMin: 12, answerMax: 12 }))).toBe('Choose 12.');
  });
});

describe('the None option', () => {
  it('is offered exactly when no answer is demanded', () => {
    expect(offersNone(choice({ answerMin: 0 }))).toBe(true);
    expect(offersNone(choice({ answerMin: 1 }))).toBe(false);
  });

  it('is ticked precisely when nothing else is', () => {
    expect(isNoneSelected([])).toBe(true);
    expect(isNoneSelected(['A'])).toBe(false);
  });

  it('clears everything else when it is ticked', () => {
    expect(selectNone()).toEqual([]);
  });

  it('unticks itself the moment any answer is ticked', () => {
    // Not a separate flag to clear: None *is* the empty selection, so this
    // holds everywhere at once rather than wherever somebody remembered.
    expect(isNoneSelected(toggleChoice(choice(), [], 'A'))).toBe(false);
  });
});

describe('toggleChoice', () => {
  it('adds an answer that was not selected', () => {
    expect(toggleChoice(choice(), ['A'], 'B')).toEqual(['A', 'B']);
  });

  it('removes an answer that was', () => {
    expect(toggleChoice(choice(), ['A', 'B'], 'A')).toEqual(['B']);
  });

  it('replaces rather than refuses when only one answer is allowed', () => {
    // A one-answer question behaves like the radio group it is; refusing would
    // mean untick-then-tick to change your mind.
    expect(toggleChoice(choice({ answerMax: 1 }), ['A'], 'B')).toEqual(['B']);
  });

  it('refuses a further answer once a multi-answer question is full', () => {
    expect(toggleChoice(choice({ answerMax: 3 }), ['A', 'B', 'C'], 'D')).toEqual(['A', 'B', 'C']);
  });

  it('still lets a full question untick one of its own answers', () => {
    expect(toggleChoice(choice({ answerMax: 3 }), ['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });
});

describe('canSelectMore', () => {
  it('is false once a multi-answer question is full, so the screen can disable the rest', () => {
    expect(canSelectMore(choice({ answerMax: 3 }), ['A', 'B'])).toBe(true);
    expect(canSelectMore(choice({ answerMax: 3 }), ['A', 'B', 'C'])).toBe(false);
  });

  it('stays true for a one-answer question, which replaces instead of filling up', () => {
    expect(canSelectMore(choice({ answerMax: 1 }), ['A'])).toBe(true);
  });
});

describe('isEnabled', () => {
  const conditional = choice({
    key: 'Pre-Payment',
    answerMax: 1,
    enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
  });
  const noLookup = new Map<string, FormQuestion>();

  it('is true for a question with no condition', () => {
    expect(isEnabled(choice(), {}, noLookup)).toBe(true);
  });

  it('is false until the question it depends on is answered that way', () => {
    expect(isEnabled(conditional, {}, noLookup)).toBe(false);
    expect(isEnabled(conditional, { needsFuelHelp: '' }, noLookup)).toBe(false);
    expect(isEnabled(conditional, { needsFuelHelp: 'Yes' }, noLookup)).toBe(true);
  });

  it('reads a condition on a choice question, whose answer is a list', () => {
    expect(isEnabled(conditional, { needsFuelHelp: ['Yes'] }, noLookup)).toBe(true);
    expect(isEnabled(conditional, { needsFuelHelp: [] }, noLookup)).toBe(false);
  });

  it('is greyed out when its own controller is, even if its stored answer would otherwise match', () => {
    // needsFuelHelp still holds "Yes" — left over from before wantsHelp
    // existed, say — but wantsHelp now says no, so needsFuelHelp is itself
    // greyed out and Pre-Payment must follow it down rather than trust its
    // own condition in isolation.
    const grandparent: FormQuestion = {
      key: 'needsFuelHelp',
      type: 'keyField',
      field: 'needsFuelHelp',
      label: 'Fuel help?',
      required: false,
      enabledWhen: { questionKey: 'wantsHelp', hasAnswer: 'Yes' },
    };
    const chained = new Map<string, FormQuestion>([[grandparent.key, grandparent]]);

    expect(isEnabled(conditional, { wantsHelp: '', needsFuelHelp: 'Yes' }, chained)).toBe(false);
    expect(isEnabled(conditional, { wantsHelp: 'Yes', needsFuelHelp: 'Yes' }, chained)).toBe(true);
  });
});

describe('clearDisabledAnswers', () => {
  const fuel: FormQuestion = {
    key: 'needsFuelHelp',
    type: 'keyField',
    field: 'needsFuelHelp',
    label: 'Fuel help?',
    required: false,
  };
  const prePayment = choice({
    key: 'Pre-Payment',
    answerMax: 1,
    options: [{ value: 'Yes', label: 'Yes' }],
    enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
  });

  it('empties an answer to a question that has since been greyed out', () => {
    // Say yes to fuel, tick the meter question, change your mind. Without
    // this the form still claims the client is on a pre-payment meter, and
    // nothing on screen says so.
    const answers = { needsFuelHelp: '', 'Pre-Payment': ['Yes'] };

    expect(clearDisabledAnswers(form(fuel, prePayment), answers)).toEqual({
      needsFuelHelp: '',
      'Pre-Payment': [],
    });
  });

  it('leaves an answer to a still-enabled question alone', () => {
    const answers = { needsFuelHelp: 'Yes', 'Pre-Payment': ['Yes'] };
    expect(clearDisabledAnswers(form(fuel, prePayment), answers)).toEqual(answers);
  });

  it('returns the same object when nothing needed clearing', () => {
    // So a caller can use it as a re-render guard on every keystroke.
    const answers = { needsFuelHelp: '', 'Pre-Payment': [] };
    expect(clearDisabledAnswers(form(fuel, prePayment), answers)).toBe(answers);
  });

  it('clears a question two levels down the chain in the same pass as the one directly above it', () => {
    const top = choice({
      key: 'Smart Meter',
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
    });
    const middle = choice({
      key: 'Pre-Payment',
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
      enabledWhen: { questionKey: 'Smart Meter', hasAnswer: 'Yes' },
    });
    const bottom = choice({
      key: 'Debt Amount',
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
      enabledWhen: { questionKey: 'Pre-Payment', hasAnswer: 'Yes' },
    });
    // Smart Meter was never Yes, so Pre-Payment should never have been
    // enabled either — and Debt Amount, under Pre-Payment, is stale twice
    // over. One ordered walk of the form must clear both, not just the one
    // directly beneath Smart Meter.
    const answers = { 'Smart Meter': [], 'Pre-Payment': ['Yes'], 'Debt Amount': ['Yes'] };

    expect(clearDisabledAnswers(form(top, middle, bottom), answers)).toEqual({
      'Smart Meter': [],
      'Pre-Payment': [],
      'Debt Amount': [],
    });
  });
});

describe('enabledQuestions', () => {
  it('leaves out the greyed-out ones, so a page validates only what can be answered', () => {
    const definition = form(
      {
        key: 'needsFuelHelp',
        type: 'keyField',
        field: 'needsFuelHelp',
        label: 'Fuel?',
        required: false,
      },
      choice({
        key: 'Pre-Payment',
        enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
      }),
    );
    const [page] = definition.pages;
    expect(page).toBeDefined();

    expect(
      enabledQuestions(definition, page!, {})
        .filter((question) => question.type !== 'information')
        .map((question) => question.key),
    ).toEqual(['needsFuelHelp']);
    expect(enabledQuestions(definition, page!, { needsFuelHelp: 'Yes' })).toHaveLength(2);
  });

  it('resolves a controller that sits on an earlier page', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'One',
          questions: [
            {
              key: 'needsFuelHelp',
              type: 'keyField',
              field: 'needsFuelHelp',
              label: 'Fuel?',
              required: false,
            },
          ],
        },
        {
          pageNum: 2,
          pageTitle: 'Two',
          questions: [
            choice({
              key: 'Pre-Payment',
              enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
            }),
          ],
        },
      ],
    };
    const [, pageTwo] = definition.pages;
    expect(pageTwo).toBeDefined();

    expect(enabledQuestions(definition, pageTwo!, {})).toHaveLength(0);
    expect(enabledQuestions(definition, pageTwo!, { needsFuelHelp: 'Yes' })).toHaveLength(1);
  });
});

describe('isYesNoChoice', () => {
  it('is true for a choose-up-to-one question whose one answer is Yes', () => {
    expect(isYesNoChoice(choice({ answerMax: 1, options: [{ value: 'Yes', label: 'Yes' }] }))).toBe(
      true,
    );
  });

  it('is false when more than one answer is on offer, even if one of them is Yes', () => {
    expect(
      isYesNoChoice(
        choice({
          answerMax: 1,
          options: [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is false for a question that allows more than one answer', () => {
    expect(isYesNoChoice(choice({ answerMax: 2, options: [{ value: 'Yes', label: 'Yes' }] }))).toBe(
      false,
    );
  });

  it('is false when the one option on offer is not literally Yes', () => {
    expect(
      isYesNoChoice(choice({ answerMax: 1, options: [{ value: 'Maybe', label: 'Maybe' }] })),
    ).toBe(false);
  });

  it('is false when the options come from a server-side list', () => {
    expect(
      isYesNoChoice(
        choice({
          answerMax: 1,
          options: [{ value: 'Yes', label: 'Yes' }],
          optionsFrom: 'referralReasons',
        }),
      ),
    ).toBe(false);
  });
});

describe('describePageProgress', () => {
  it('counts from one, because nobody calls the first page page zero', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [1, 2, 3].map((pageNum) => ({
        pageNum,
        pageTitle: `Page ${String(pageNum)}`,
        questions: [
          {
            key: `q${String(pageNum)}`,
            type: 'text',
            label: 'Q',
            required: false,
            preference: false,
            maxLength: 10,
          },
        ],
      })),
    };

    expect(describePageProgress(definition, 0)).toBe('Page 1 of 3');
    expect(describePageProgress(definition, 2)).toBe('Page 3 of 3');
  });
});
