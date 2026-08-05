import {
  isDynamicQuestion,
  type DynamicQuestion,
  type FormQuestion,
  type ReferralFormDefinition,
} from './referral-form-definition';
import { parseIntegerAnswer } from './referral-form-schema';
import { isEnabled, type FormAnswers } from './referral-form.logic';
import { keyFieldValue } from './referral-key-fields';

/**
 * Takes a filled-in form apart into what `POST /public/referrals` wants: the
 * typed columns at the top level, everything else in the `answers` bag.
 *
 * `referral details.txt`: "I suspect the simplest implementation is to build a
 * map of all the values and then extract the key fields at update time." That
 * is exactly this. One map while somebody is filling the form in, which is what
 * lets `enabledWhen` name a key field and a dynamic question in the same
 * breath; two shapes at the moment of sending, because the server has typed
 * columns and an opaque blob and they are validated differently.
 *
 * **Three things are omitted rather than sent empty**, and all three for the
 * same reason: an empty string stored against a key is a real, blank answer to
 * a question, which reads back later as something quite different from a
 * question nobody was asked.
 *
 * - An unanswered optional question.
 * - A choice question left on "None" — see `referral-form.logic.ts`.
 * - A greyed-out question, whatever it happens to be holding. `clearDisabledAnswers`
 *   should already have emptied it; this is the second lock on the same door,
 *   because the cost of it being wrong is a claim about somebody's gas meter
 *   that nobody made.
 *
 * No React, no fetching, tested directly.
 */

/** The typed columns, as the submission body wants them. `null` is a real value here — an optional phone that was left blank. */
export type KeyFieldValues = Readonly<Record<string, string | number | boolean | null>>;

/** The dynamic answers. A choice with more than one answer stays an array; the server stores whatever JSON it is given. */
export type AnswersPayload = Readonly<Record<string, string | number | readonly string[]>>;

export interface ReferralSubmissionParts {
  readonly keyFields: KeyFieldValues;
  readonly answers: AnswersPayload;
}

/**
 * Assumes `answers` already passed the schema — a bad number falls back to its
 * raw text rather than throwing, so a caller that skipped validation gets a
 * wrong-shaped payload the server will `400` rather than a client crash.
 */
export function splitSubmission(
  definition: ReferralFormDefinition,
  answers: FormAnswers,
): ReferralSubmissionParts {
  const keyFields: Record<string, string | number | boolean | null> = {};
  const dynamic: Record<string, string | number | readonly string[]> = {};

  for (const page of definition.pages) {
    for (const question of page.questions) {
      if (!isEnabled(question, answers)) continue;

      const held = answers[question.key];

      if (question.type === 'keyField') {
        const value = keyFieldValue(question.field, typeof held === 'string' ? held : '');
        if (value === null) continue;
        keyFields[question.field] = value;
        continue;
      }

      const value = toAnswerValue(question, held);
      if (value === null) continue;
      dynamic[question.key] = value;
    }
  }

  return { keyFields, answers: dynamic };
}

/** `null` means "leave this question out of `answers` entirely". */
function toAnswerValue(
  question: DynamicQuestion,
  held: string | readonly string[] | undefined,
): string | number | readonly string[] | null {
  if (question.type === 'choice') {
    // Not `Array.isArray`: it widens a `readonly string[]` to `any[]`, which
    // costs the payload's type all the way out.
    const selected: readonly string[] = held === undefined || typeof held === 'string' ? [] : held;
    // The "None" case, and the only reason an empty array is not stored: it is
    // how the form renders "not asked for", not an answer of "nothing".
    if (selected.length === 0) return null;
    // A single-answer question stores the answer, not a list of one — it reads
    // back as `Eggs: "Yes"`, which is what `referral details.txt` describes.
    return question.answerMax === 1 ? (selected[0] ?? null) : [...selected];
  }

  if (typeof held !== 'string') return null;
  const trimmed = held.trim();
  if (trimmed === '') return null;

  if (question.type === 'number') {
    const parsed = parseIntegerAnswer(trimmed, question);
    return parsed.ok ? parsed.value : trimmed;
  }

  return trimmed;
}

/**
 * The fixed fields a referrer is shown back on the confirmation screen.
 *
 * `referral details.txt`: "They should get a confirmation message with the
 * mandatory fields shown, but once submitted they cannot change." There is no
 * amending any more, so this page is the referrer's only chance to notice that
 * the surname is wrong before they have to telephone about it — which is why it
 * shows what was sent rather than a receipt number.
 */
export interface ConfirmationLine {
  readonly label: string;
  readonly value: string;
}

export function describeSubmission(
  definition: ReferralFormDefinition,
  answers: FormAnswers,
): readonly ConfirmationLine[] {
  const lines: ConfirmationLine[] = [];

  for (const page of definition.pages) {
    for (const question of page.questions) {
      if (!question.required || !isEnabled(question, answers)) continue;

      const value = confirmationValue(question, answers[question.key]);
      if (value === '') continue;

      lines.push({ label: question.label, value });
    }
  }

  return lines;
}

/**
 * **What was sent, not what was typed.** The postcode is the case that makes
 * the difference matter: somebody types `gu234xx` and the referral stores
 * `GU23 4XX`, and a confirmation showing the first would be showing them
 * something that is not on their referral.
 */
function confirmationValue(
  question: FormQuestion,
  held: string | readonly string[] | undefined,
): string {
  if (question.type === 'keyField') {
    const sent = keyFieldValue(question.field, typeof held === 'string' ? held : '');
    return sent === null ? '' : String(sent);
  }

  return typeof held === 'string' ? held.trim() : (held ?? []).join(', ');
}

/** The preference answers on a submitted referral, in the order the form asks them — what the pick-list screen shows. */
export function preferenceQuestions(
  definition: ReferralFormDefinition,
): readonly DynamicQuestion[] {
  return definition.pages
    .flatMap((page) => page.questions)
    .filter(isDynamicQuestion)
    .filter((question) => question.preference);
}
