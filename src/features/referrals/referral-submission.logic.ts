import {
  isDynamicQuestion,
  type DynamicQuestion,
  type FormQuestion,
  type ReferralFormDefinition,
} from './referral-form-definition';
import { parseIntegerAnswer } from './referral-form-schema';
import { isEnabled, type FormAnswers } from './referral-form.logic';
import { keyFieldSpec, keyFieldValue } from './referral-key-fields';
import { lookupLabel, type ReferralLookups } from './referral-lookups';
import {
  isHouseholdComposition,
  operationalHouseholdCounts,
  type HouseholdComposition,
} from './household-composition';

/** Stored in answers; the fixed flag remains available to every server workflow. */
export const COLLECTION_METHOD_KEY = 'Collection method';
export const DELIVERY_REQUESTED = 'Delivery Requested';

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
export type AnswersPayload = Readonly<
  Record<string, string | number | readonly string[] | HouseholdComposition>
>;

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
  const dynamic: Record<string, string | number | readonly string[] | HouseholdComposition> = {};

  for (const page of definition.pages) {
    for (const question of page.questions) {
      if (!isEnabled(question, answers)) continue;
      if (question.type === 'information') continue;

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

      if (question.type === 'householdComposition' && isHouseholdComposition(value)) {
        Object.assign(keyFields, operationalHouseholdCounts(value));
      }
    }
  }

  // Older definitions used an `isDelivery` key field.  Only the current
  // questionnaire has a collection-method answer from which to derive it.
  if (Object.hasOwn(dynamic, COLLECTION_METHOD_KEY)) {
    keyFields.isDelivery = dynamic[COLLECTION_METHOD_KEY] === DELIVERY_REQUESTED;
  }

  return { keyFields, answers: dynamic };
}

/** `null` means "leave this question out of `answers` entirely". */
function toAnswerValue(
  question: DynamicQuestion,
  held: string | readonly string[] | HouseholdComposition | undefined,
): string | number | readonly string[] | HouseholdComposition | null {
  if (question.type === 'choice') {
    // Not `Array.isArray`: it widens a `readonly string[]` to `any[]`, which
    // costs the payload's type all the way out.
    const selected: readonly string[] = Array.isArray(held) ? held : [];
    // The "None" case, and the only reason an empty array is not stored: it is
    // how the form renders "not asked for", not an answer of "nothing".
    if (selected.length === 0) return null;
    // A single-answer question stores the answer, not a list of one — it reads
    // back as `Eggs: "Yes"`, which is what `referral details.txt` describes.
    return question.answerMax === 1 ? (selected[0] ?? null) : [...selected];
  }

  if (question.type === 'householdComposition') return isHouseholdComposition(held) ? held : null;
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
  lookups: ReferralLookups,
): readonly ConfirmationLine[] {
  const lines: ConfirmationLine[] = [];

  for (const page of definition.pages) {
    for (const question of page.questions) {
      if (question.type === 'information') continue;
      if (!question.required || !isEnabled(question, answers)) continue;

      const value = confirmationValue(question, answers[question.key], lookups);
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
 *
 * **The two lookups are the exception, and they go the other way.** The session
 * and the reason are sent as ids, and an id is exactly what a referrer cannot
 * check — "is the session right?" is unanswerable against a UUID, and it is the
 * question this screen exists to let them ask. So they read back as the words
 * the dropdown offered. Falling back to the id is deliberate but is only ever
 * reached if a lookup went missing between choosing and sending; something
 * unhelpful beats a blank line where the session should be.
 */
function confirmationValue(
  question: FormQuestion,
  held: string | readonly string[] | HouseholdComposition | undefined,
  lookups: ReferralLookups,
): string {
  if (question.type === 'keyField') {
    const sent = keyFieldValue(question.field, typeof held === 'string' ? held : '');
    if (sent === null) return '';

    const { control } = keyFieldSpec(question.field);
    if (control.kind === 'lookup')
      return lookupLabel(lookups, control.source, String(sent)) ?? String(sent);

    return String(sent);
  }

  if (question.type === 'householdComposition' && isHouseholdComposition(held)) {
    const { adults, children } = operationalHouseholdCounts(held);
    return `${String(adults)} adults, ${String(children)} children`;
  }
  return typeof held === 'string' ? held.trim() : (Array.isArray(held) ? held : []).join(', ');
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
