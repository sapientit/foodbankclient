import {
  findQuestion,
  isDynamicQuestion,
  type ChoiceQuestion,
  type DynamicQuestion,
  type ReferralFormDefinition,
} from './referral-form-definition';

/**
 * Turns a referral's `answers` bag into labelled lines a staff screen can
 * render, against the **current** form definition — which is not necessarily
 * the definition the referral was captured under, because the definition
 * changes with a client release and old referrals keep the keys they were
 * asked under (`CLAUDE.md`: "a referral captured last year comes back with
 * the keys it was captured under").
 *
 * Three cases, none of which may look like a bug:
 *
 * - A key the current definition still knows renders its label and a value
 *   read per that question's type — an option's `label`, not its stored
 *   `value`.
 * - A key the current definition does not know — an older or since-retired
 *   question — still renders, under its raw key, because
 *   `CLAUDE.md`/`API.md` are explicit that "unknown keys are stored, not
 *   dropped" and this is the one place that promise gets kept or broken.
 * - A purged referral (`piiPurgedAt` set) has no answers to render at all,
 *   and says so rather than showing an empty section a volunteer would read
 *   as a bug in the screen.
 *
 * No React, no fetching, tested directly.
 */

export interface AnswerLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** An older or retired question this definition no longer describes. */
  readonly isUnknownKey: boolean;
  /**
   * A question about what the household wants or can eat, rather than about the
   * household. `screenDetails.md`: it is this kind the picking list screen has
   * to show. An unknown key is never one — nothing knows what it was.
   */
  readonly isPreference: boolean;
}

export type AnswersDisplay =
  | { readonly kind: 'purged' }
  | { readonly kind: 'no-answers' }
  | { readonly kind: 'answers'; readonly lines: readonly AnswerLine[] };

/**
 * The minimum a caller needs, rather than the generated `Referral` type —
 * this file has no reason to import `src/api/schema` (only a feature's
 * `queries.ts` may), and a future referrals screen can pass its query result
 * straight in because the shape is a structural subset of it.
 */
export interface ReferralAnswersSource {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly piiPurgedAt: string | null;
}

export function describeAnswers(
  definition: ReferralFormDefinition,
  referral: ReferralAnswersSource,
): AnswersDisplay {
  if (referral.piiPurgedAt !== null) return { kind: 'purged' };

  const entries = Object.entries(referral.answers);
  if (entries.length === 0) return { kind: 'no-answers' };

  const lines = entries.map(([key, value]) => renderAnswerLine(definition, key, value));
  return { kind: 'answers', lines };
}

function renderAnswerLine(
  definition: ReferralFormDefinition,
  key: string,
  value: unknown,
): AnswerLine {
  const question = findQuestion(definition, key);

  // A key field is never in the `answers` bag, so a key that matches one is as
  // unknown as any other — it means an older form stored an answer under a name
  // that is now a column, and showing it raw is the honest rendering.
  if (question === undefined || !isDynamicQuestion(question)) {
    return {
      key,
      label: key,
      value: describeRawValue(value),
      isUnknownKey: true,
      isPreference: false,
    };
  }

  return {
    key,
    label: question.label,
    value: describeKnownValue(question, value),
    isUnknownKey: false,
    isPreference: question.preference,
  };
}

function describeKnownValue(question: DynamicQuestion, value: unknown): string {
  switch (question.type) {
    case 'choice':
      return describeChoiceValue(question, value);
    case 'number':
      return typeof value === 'number' ? String(value) : describeRawValue(value);
    case 'text':
      return typeof value === 'string' ? value : describeRawValue(value);
  }
}

/**
 * A choice reads back either as one stored value or as a list of them, because
 * that is how it was stored: a single-answer question keeps `Eggs: "Yes"`
 * rather than `["Yes"]`. Both render as the labels, comma separated.
 */
function describeChoiceValue(question: ChoiceQuestion, value: unknown): string {
  const stored = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(stored)) return describeRawValue(value);

  const labels = stored.map((entry: unknown) =>
    typeof entry === 'string' ? describeOption(question, entry) : describeRawValue(entry),
  );
  return labels.join(', ');
}

function describeOption(question: ChoiceQuestion, value: string): string {
  // The option list can change between releases, and a question whose options
  // come from a server lookup has none here at all; a stored value that matches
  // nothing still has to render as *something*, not vanish.
  if (question.optionsFrom !== undefined) return value;

  const option = question.options.find((candidate) => candidate.value === value);
  return option === undefined ? `${value} (no longer offered)` : option.label;
}

/**
 * Any JSON value, rendered without throwing — the fallback for an unknown key
 * (which could hold anything an old form version put there) and for a known
 * key whose stored value does not match what the question expects today.
 */
function describeRawValue(value: unknown): string {
  if (value === null || value === undefined) return '(no answer)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
