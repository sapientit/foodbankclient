import * as z from 'zod';
import {
  type ChoiceQuestion,
  type FormPage,
  type FormQuestion,
  type NumberQuestion,
  type ReferralFormDefinition,
  type TextQuestion,
} from './referral-form-definition';
import { keyFieldSchema } from './referral-key-fields';

/**
 * Turns a `ReferralFormDefinition` into a Zod schema, so the questions and
 * their validation are two views of one definition rather than two things that
 * can drift apart. `.claude/rules/referral-form.md`: "Build the Zod schema from
 * the definition, never by hand."
 *
 * **Every field is a string, or an array of them.** React Hook Form gives back
 * exactly what a control holds — a string for an input or a select, a list of
 * checked values for a checkbox group — never the answer's eventual type, and
 * an `<input type="number">` cannot tell an empty box from a lone minus sign.
 * That is why `parseIntegerAnswer` exists here and `keyFieldValue` exists next
 * door: re-parsing validated strings is a deliberate second half, in
 * `referral-submission.logic.ts`.
 *
 * **The form validates a page at a time.** Somebody on page four should not be
 * told about a blank box on page one, and somebody on page one should not be
 * let through to page two with one. `buildPageSchema` is what the wizard's
 * "next" runs; `buildFormSchema` is what submit runs, because a page that was
 * never visited was never validated.
 *
 * No React, no fetching, tested directly.
 */

/** What React Hook Form holds for the whole form: a string per field, a list per choice group. */
export type RawAnswers = Readonly<Record<string, string | readonly string[]>>;

export function buildFormSchema(definition: ReferralFormDefinition) {
  return buildSchemaFor(definition.pages.flatMap((page) => page.questions));
}

export function buildPageSchema(page: FormPage) {
  return buildSchemaFor(page.questions);
}

function buildSchemaFor(questions: readonly FormQuestion[]) {
  const shape: Record<string, z.ZodType<string> | z.ZodType<string[]>> = {};
  for (const question of questions) {
    shape[question.key] = questionFieldSchema(question);
  }
  // `.strict()`: an unexpected key means this client's own form sent something
  // the definition does not describe, which is a bug in the form component to
  // catch here — not a shape a referrer's browser could produce on its own,
  // since every field it can fill in comes from this definition.
  return z.object(shape).strict();
}

function questionFieldSchema(question: FormQuestion): z.ZodType<string> | z.ZodType<string[]> {
  switch (question.type) {
    case 'keyField':
      return keyFieldSchema(question.field, question);
    case 'text':
      return textFieldSchema(question);
    case 'number':
      return numberFieldSchema(question);
    case 'choice':
      return choiceFieldSchema(question);
  }
}

function textFieldSchema(question: TextQuestion): z.ZodType<string> {
  const schema = z
    .string()
    .max(
      question.maxLength,
      `${question.label}: use ${String(question.maxLength)} characters or fewer.`,
    );
  return question.required ? schema.min(1, `${question.label} is required.`) : schema;
}

function numberFieldSchema(question: NumberQuestion): z.ZodType<string> {
  return z.string().superRefine((value, ctx) => {
    if (value.trim() === '') {
      if (question.required) {
        ctx.addIssue({ code: 'custom', message: `${question.label} is required.` });
      }
      return;
    }

    const parsed = parseIntegerAnswer(value, question);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: describeIntegerProblem(question, parsed.problem) });
    }
  });
}

/**
 * The checked values, counted against the question's floor and ceiling.
 *
 * **An empty selection is valid whenever `answerMin` is 0**, and means "None" —
 * the generated choice `referral-form.logic.ts` adds and this schema
 * deliberately knows nothing about, because None is a rendering of "no
 * answers", not an answer with a value. A question with `answerMin: 1` has no
 * None to choose and an empty selection is the error below.
 *
 * Values are not checked against the offered options when they come from a
 * runtime list (`optionsFrom`), for the same reason as `keyFieldSchema`'s
 * lookups: the renderer can only offer what it was given.
 */
function choiceFieldSchema(question: ChoiceQuestion): z.ZodType<string[]> {
  const offered = new Set(question.options.map((option) => option.value));

  return z.array(z.string()).superRefine((values, ctx) => {
    if (values.length < question.answerMin) {
      ctx.addIssue({ code: 'custom', message: describeTooFew(question) });
      return;
    }

    if (values.length > question.answerMax) {
      ctx.addIssue({ code: 'custom', message: describeTooMany(question) });
      return;
    }

    if (question.optionsFrom !== undefined) return;

    for (const value of values) {
      if (!offered.has(value)) {
        ctx.addIssue({
          code: 'custom',
          message: `That is not a valid answer for ${question.label}.`,
        });
      }
    }
  });
}

function describeTooFew(question: ChoiceQuestion): string {
  return question.answerMin === 1
    ? `Choose an answer for ${question.label}.`
    : `${question.label}: choose at least ${String(question.answerMin)} answers.`;
}

function describeTooMany(question: ChoiceQuestion): string {
  return question.answerMax === 1
    ? `${question.label}: choose only one answer.`
    : `${question.label}: choose no more than ${String(question.answerMax)} answers.`;
}

export type IntegerAnswerProblem = 'not-a-whole-number' | 'below-minimum' | 'above-maximum';

export type IntegerAnswerResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: IntegerAnswerProblem };

/**
 * A signed whole number, optionally bounded — held and parsed as text for the
 * same reason as every other whole-number parser in this codebase. Signed,
 * unlike `parseWholeNumber` in sessions and model-parcels: those are always
 * quantities or durations, but a generic form "number" question has no
 * domain-wide reason to forbid a negative answer, so the bound is whatever the
 * question declares rather than an assumed zero floor.
 */
export function parseIntegerAnswer(
  text: string,
  bounds: { readonly minimum?: number; readonly maximum?: number },
): IntegerAnswerResult {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };
  if (bounds.minimum !== undefined && value < bounds.minimum)
    return { ok: false, problem: 'below-minimum' };
  if (bounds.maximum !== undefined && value > bounds.maximum)
    return { ok: false, problem: 'above-maximum' };

  return { ok: true, value };
}

function describeIntegerProblem(question: NumberQuestion, problem: IntegerAnswerProblem): string {
  switch (problem) {
    case 'not-a-whole-number':
      return `${question.label}: enter a whole number.`;
    case 'below-minimum':
      return `${question.label}: use ${String(question.minimum)} or more.`;
    case 'above-maximum':
      return `${question.label}: use ${String(question.maximum)} or fewer.`;
  }
}

/**
 * What every field on the form starts as, before anybody has typed anything —
 * the `Default` column of `Referral questions.csv`, and an empty string or an
 * empty selection for everything that has no default.
 *
 * React Hook Form needs a value for every field from the outset: a control that
 * starts `undefined` and becomes a string is an uncontrolled input becoming a
 * controlled one, which React warns about and which loses the first keystroke.
 */
export function defaultAnswers(
  definition: ReferralFormDefinition,
): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};

  for (const page of definition.pages) {
    for (const question of page.questions) {
      answers[question.key] = question.type === 'choice' ? [...(question.default ?? [])] : '';
    }
  }

  return answers;
}
