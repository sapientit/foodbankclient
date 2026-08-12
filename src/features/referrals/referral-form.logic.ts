import type {
  ChoiceQuestion,
  FormPage,
  FormQuestion,
  ReferralFormDefinition,
} from './referral-form-definition';
import { YES } from './referral-key-fields';
import type { HouseholdComposition } from './household-composition';

/**
 * What a page of the referral form does on screen: the instruction under a
 * choice, the "None" that is not an answer, and the two questions that grey out
 * until the fuel question is answered.
 *
 * All of it is pure and all of it is the part worth testing. A wrong
 * instruction line is a form somebody fills in twice; a "None" that stores a
 * value is a household recorded as wanting nothing rather than as never having
 * been asked.
 *
 * No React, no fetching, tested directly.
 */

/** One answer's worth of what React Hook Form holds — a string for an input, a list for a choice. */
export type AnswerValue = string | readonly string[] | HouseholdComposition;

export type FormAnswers = Readonly<Record<string, AnswerValue>>;

/**
 * The line under a choice question telling somebody how many to pick.
 *
 * `referral details.txt`: "There will be an instruction line: 'Choose 1 entry'
 * for both questions... For this question the instruction will be 'Choose up to
 * 3 entries' (answerMax = 3)." Generated rather than written into the config,
 * because an instruction that disagrees with the validation is worse than none.
 */
export function choiceInstruction(question: ChoiceQuestion): string {
  const { answerMin: min, answerMax: max } = question;

  if (min === max) return `Choose ${count(min)}.`;
  if (min === 0) return `Choose up to ${count(max)}, or None.`;
  return `Choose between ${count(min)} and ${count(max)}.`;
}

function count(value: number): string {
  const words = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return words[value] ?? String(value);
}

/**
 * Whether this question offers a "None" box.
 *
 * **None is a rendering of an empty selection, not a value.**
 * `referral details.txt`: "None is also not recorded as a value. So if the
 * referrer clicks 'yes' for eggs, then there will be an eggs: 'Yes' entry. If
 * they click none (the default value) then no entry will be recorded." Keeping
 * it out of the stored array is what makes that true everywhere at once —
 * nothing downstream has to remember to strip a sentinel.
 */
export function offersNone(question: ChoiceQuestion): boolean {
  return question.answerMin === 0;
}

/** Whether the "None" box is ticked, which is exactly when nothing else is. */
export function isNoneSelected(selected: readonly string[]): boolean {
  return selected.length === 0;
}

/**
 * The selection after ticking or unticking `value`.
 *
 * Ticking anything unticks None, because None **is** the empty selection —
 * there is no separate flag to clear. A single-answer question replaces rather
 * than refuses, so it behaves like the radio group it is; a multi-answer one at
 * its ceiling refuses, and `canSelectMore` is what lets the screen disable the
 * remaining boxes rather than letting somebody click one that does nothing.
 */
export function toggleChoice(
  question: ChoiceQuestion,
  selected: readonly string[],
  value: string,
): readonly string[] {
  if (selected.includes(value)) return selected.filter((chosen) => chosen !== value);
  if (question.answerMax === 1) return [value];
  if (selected.length >= question.answerMax) return selected;
  return [...selected, value];
}

/** Ticking None clears everything else. */
export function selectNone(): readonly string[] {
  return [];
}

/** Whether an unticked box should still be clickable. False once a multi-answer question is full. */
export function canSelectMore(question: ChoiceQuestion, selected: readonly string[]): boolean {
  return question.answerMax === 1 || selected.length < question.answerMax;
}

/**
 * Whether a question is answerable, or greyed out waiting on another one.
 *
 * `Referral questions.csv` rows 42-43: "Greyed out unless Yes for fuel."
 * Deliberately **one level** — a question that enables another is itself always
 * enabled, and `referral-form-config.ts` refuses a config where that is not
 * true. Chained conditions would need cycle detection and a form nobody could
 * reason about, for a rule two rows of the CSV need.
 */
export function isEnabled(question: FormQuestion, answers: FormAnswers): boolean {
  const condition = question.enabledWhen;
  if (condition === undefined) return true;

  const value = answers[condition.questionKey];
  if (value === undefined) return false;

  return typeof value === 'string'
    ? value === condition.hasAnswer
    : Array.isArray(value) && value.includes(condition.hasAnswer);
}

/**
 * The answers with every greyed-out question emptied.
 *
 * The case this exists for: say yes to fuel, tick the two questions underneath,
 * then change your mind and say no. Without this, the form still holds — and
 * submits — a claim that the client is on a pre-payment meter, which nobody
 * asked and nobody can see on screen. Run it whenever an answer changes.
 *
 * Returns the same object when nothing needed clearing, so a caller can use it
 * as a `setState` guard without re-rendering the whole form on every keystroke.
 */
export function clearDisabledAnswers(
  definition: ReferralFormDefinition,
  answers: FormAnswers,
): FormAnswers {
  let cleared: Record<string, AnswerValue> | null = null;

  for (const page of definition.pages) {
    for (const question of page.questions) {
      if (question.enabledWhen === undefined || isEnabled(question, answers)) continue;

      const empty: AnswerValue = question.type === 'choice' ? [] : '';
      const current = answers[question.key];
      if (isEmptyAnswer(current)) continue;

      cleared ??= { ...answers };
      cleared[question.key] = empty;
    }
  }

  return cleared ?? answers;
}

function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  return typeof value === 'string'
    ? value.trim() === ''
    : Array.isArray(value) && value.length === 0;
}

/** The questions on a page that are not greyed out — what a page's validation applies to. */
export function enabledQuestions(page: FormPage, answers: FormAnswers): readonly FormQuestion[] {
  return page.questions.filter((question) => isEnabled(question, answers));
}

/** `Page 3 of 7`. Announced as well as shown: on a phone the pages are the only sense of how much is left. */
export function describePageProgress(
  definition: ReferralFormDefinition,
  pageIndex: number,
): string {
  return `Page ${String(pageIndex + 1)} of ${String(definition.pages.length)}`;
}

/**
 * The value a `yesNo` key field holds when it is ticked — re-exported so the
 * form renderer has one import for everything it needs to draw a page.
 */
export { YES };
