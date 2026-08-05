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
  it('says to choose one when exactly one is wanted', () => {
    expect(choiceInstruction(choice({ answerMin: 1, answerMax: 1 }))).toBe('Choose one.');
  });

  it('offers None when none is allowed', () => {
    expect(choiceInstruction(choice({ answerMin: 0, answerMax: 1 }))).toBe(
      'Choose up to one, or None.',
    );
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

  it('is true for a question with no condition', () => {
    expect(isEnabled(choice(), {})).toBe(true);
  });

  it('is false until the question it depends on is answered that way', () => {
    expect(isEnabled(conditional, {})).toBe(false);
    expect(isEnabled(conditional, { needsFuelHelp: '' })).toBe(false);
    expect(isEnabled(conditional, { needsFuelHelp: 'Yes' })).toBe(true);
  });

  it('reads a condition on a choice question, whose answer is a list', () => {
    expect(isEnabled(conditional, { needsFuelHelp: ['Yes'] })).toBe(true);
    expect(isEnabled(conditional, { needsFuelHelp: [] })).toBe(false);
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

    expect(enabledQuestions(page!, {}).map((q) => q.key)).toEqual(['needsFuelHelp']);
    expect(enabledQuestions(page!, { needsFuelHelp: 'Yes' })).toHaveLength(2);
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
