/**
 * The shape of a referral form definition — the type `referral-form.config.json`
 * has to satisfy. See `referral-form-config.ts` for loading that file,
 * `referral-key-fields.ts` for the typed columns, `referral-form-schema.ts` for
 * turning a definition into validation, `referral-form.logic.ts` for what a
 * page does on screen, `referral-submission.logic.ts` for taking one apart
 * again at submit, and `referral-form-guards.ts` for the two things nothing
 * else in the system would notice going wrong.
 *
 * `INITIAL_SPEC1.txt`: "Like Google forms, the questions have a column key and
 * validation rules... The form is held as a configuration file belonging to the
 * referral application, not in the server and not in the database."
 *
 * **Two kinds of question, and the union keeps them apart on purpose.**
 * `screenDetails.md`: "Questions about the person are what the referral is;
 * preference questions... are what the picking list is adjusted from."
 *
 * - A `KeyFieldQuestion` names one of the server's typed columns. Its control
 *   and its validation come from `referral-key-fields.ts`, not from the JSON,
 *   because a date of birth and a postcode are not things a form config should
 *   be inventing rules for. The JSON supplies only where it sits and whether it
 *   is required.
 * - A `DynamicQuestion` is stored in the `answers` bag under its own key, and
 *   uses exactly the three kinds `referral details.txt` proposed: free text, a
 *   number, and a set of choices with a minimum and a maximum.
 *
 * Because they are separate variants rather than a flag, **a key field cannot
 * reach the `answers` bag by accident**: everything downstream of `answers`
 * takes `DynamicQuestion`, so putting one there does not compile.
 *
 * No React, no fetching, tested directly.
 */

export interface FormOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The server's typed columns on a referral, as named in `openapi.yaml`'s
 * `ReferralSubmission`. **Not `answers` keys** — these are the fixed fields
 * `.claude/rules/referral-form.md` requires stay separate and typed.
 *
 * `referrerName`, `refereeFirstName`, `refereeSurname`, `refereeDateOfBirth`
 * and `needsFuelHelp` are pending on the server; see
 * `docs/api/referral-contract-request.md`.
 */
export const KEY_FIELD_NAMES = [
  'referrerName',
  'referrerEmail',
  'referrerOrganisation',
  'referrerPhone',
  'refereeFirstName',
  'refereeSurname',
  'refereeDateOfBirth',
  'refereeAddress',
  'refereePostcode',
  'refereePhone',
  'sessionId',
  'isDelivery',
  'adults',
  'children',
  'reasonId',
  'needsFuelHelp',
] as const;

export type KeyFieldName = (typeof KEY_FIELD_NAMES)[number];

/**
 * A maintained list fetched from the server rather than written into the JSON.
 * `.claude/rules/referral-form.md`: the reason list "is a maintained lookup...
 * Fetch it; do not hard-code it." The secondary cause of crisis is chosen from
 * the same list as the primary one but is not a reported column, so it is an
 * ordinary answer that happens to take its options from there.
 */
export type ChoiceSource = 'referralReasons';

/**
 * Greys a question out until another question has been answered a particular
 * way — `Referral questions.csv` rows 42-43, both "Greyed out unless Yes for
 * fuel". A disabled question is not merely hidden: its answer is dropped, so
 * saying yes to fuel, answering the two that follow, then saying no again
 * leaves nothing behind claiming the client is on a pre-payment meter.
 *
 * Deliberately one condition on one question, not an expression language. Two
 * rows in the whole form need this, and a config file that can express
 * arbitrary logic is a config file somebody has to debug.
 */
export interface EnabledWhen {
  readonly questionKey: string;
  readonly hasAnswer: string;
}

interface BaseQuestion {
  /**
   * `questionKey` in the JSON. For a dynamic question this is the server's
   * storage key for the answer and is **permanent** — see
   * `referral-form-guards.ts`. Never derived from `label`, so relabelling a
   * question is free and reusing a key for a different question is always a
   * deliberate, visible edit.
   */
  readonly key: string;
  /** `questionTitle` in the JSON. */
  readonly label: string;
  readonly required: boolean;
  /** Shown under the field, e.g. to explain why a question is being asked. */
  readonly helpText?: string;
  readonly enabledWhen?: EnabledWhen;
  /** Marks answers which the fuel team may see on its dedicated screen. */
  readonly forFuelTeam?: boolean;
}

/** Display-only text in the form. It deliberately has no answer key. */
export interface InformationQuestion {
  readonly type: 'information';
  readonly label: string;
  readonly enabledWhen?: EnabledWhen;
}

interface BaseDynamicQuestion extends BaseQuestion {
  /**
   * Whether this is a question about what the household wants or can eat,
   * rather than about the household itself. `referral details.txt`: "the
   * preference field controls whether this will appear on the pick list
   * maintenance screen. Only preferences should be shown."
   */
  readonly preference: boolean;
  /** Whether this answer is copied into the initial parcel-note snapshot. */
  readonly pickListInformation?: boolean;
}

export interface TextQuestion extends BaseDynamicQuestion {
  readonly type: 'text';
  /**
   * **Required, not optional.** `referral-form-guards.ts`'s serialised-size
   * check has to assume a worst case for every free-text answer, and an
   * unbounded field makes that check a guess instead of an arithmetic fact.
   * It doubles as the `maxLength` on the eventual `<textarea>` or `<input>`.
   */
  readonly maxLength: number;
}

export interface NumberQuestion extends BaseDynamicQuestion {
  readonly type: 'number';
  /**
   * Whole numbers only, matching every numeric field already in this codebase
   * (`CLAUDE.md`: "Quantities are integers, never floats") — held and parsed as
   * text by `referral-form-schema.ts`, the same reasoning as `parseWholeNumber`
   * in the sessions and model-parcels features: an `<input type="number">`
   * cannot tell an empty box from a lone minus sign.
   */
  readonly minimum?: number;
  readonly maximum?: number;
}

/** A single table answer, stored as JSON for reporting. */
export interface HouseholdCompositionQuestion extends BaseDynamicQuestion {
  readonly type: 'householdComposition';
}

/**
 * A set of choices with a floor and a ceiling, which is every "choose"
 * question in `Referral questions.csv` — "Choose exactly 1" is
 * `answerMin: 1, answerMax: 1`, "Choose 0 or 1" is `0`/`1`, "0-3 from list" is
 * `0`/`3`. One variant rather than separate radio and checkbox types, because
 * the difference between them is a rendering decision the counts already carry.
 *
 * **A question with `answerMin: 0` gets a "None" choice**, generated rather
 * than declared, mutually exclusive with the rest and stored as no answer at
 * all — see `referral-form.logic.ts`. That is why an empty selection is a valid
 * state here and not an unanswered one.
 */
export interface ChoiceQuestion extends BaseDynamicQuestion {
  readonly type: 'choice';
  readonly answerMin: number;
  readonly answerMax: number;
  /** Empty when `optionsFrom` supplies them instead. */
  readonly options: readonly FormOption[];
  readonly optionsFrom?: ChoiceSource;
  /**
   * The longest an option's stored value can be. **Required when `optionsFrom`
   * is set** and ignored otherwise: the guards' byte estimate cannot measure a
   * list that arrives at runtime, and the alternative to declaring a bound is
   * not checking at all.
   */
  readonly maxAnswerLength?: number;
  /**
   * Pre-selected when the form opens — the `Default` column of the CSV. An
   * empty or absent default means "None", which is what the CSV means by
   * "unless specified, the default value will be 'none' selected".
   */
  readonly default?: readonly string[];
}

export interface KeyFieldQuestion extends BaseQuestion {
  readonly type: 'keyField';
  readonly field: KeyFieldName;
}

/** A question whose answer is stored in the `answers` bag under `key`. */
export type DynamicQuestion =
  TextQuestion | NumberQuestion | ChoiceQuestion | HouseholdCompositionQuestion;

export type FormQuestion = DynamicQuestion | KeyFieldQuestion | InformationQuestion;
export type AnswerableQuestion = DynamicQuestion | KeyFieldQuestion;

/** The types the frozen-key ledger records. Dynamic only — key fields have no `answers` key to freeze. */
export type FormFieldType = DynamicQuestion['type'];

export interface FormPage {
  readonly pageNum: number;
  readonly pageTitle: string;
  /** Ordered, and the order **is** the display order — `questionNum` in the JSON only makes that legible to a person reading it. */
  readonly questions: readonly FormQuestion[];
}

export interface ReferralFormDefinition {
  /** Bumped when the questions change. Recorded nowhere else; it is for reading a diff, not for the server. */
  readonly version: number;
  /** Ordered, and the order is the order the pages are shown in. */
  readonly pages: readonly FormPage[];
}

export function allQuestions(definition: ReferralFormDefinition): readonly FormQuestion[] {
  return definition.pages.flatMap((page) => page.questions);
}

/** Only the questions that end up in the `answers` bag — what the guards and the answers renderer work on. */
export function dynamicQuestions(definition: ReferralFormDefinition): readonly DynamicQuestion[] {
  return allQuestions(definition).filter(isDynamicQuestion);
}

export function keyFieldQuestions(definition: ReferralFormDefinition): readonly KeyFieldQuestion[] {
  return allQuestions(definition).filter(
    (question): question is KeyFieldQuestion => question.type === 'keyField',
  );
}

/**
 * The question key a typed column is answered under, or `undefined` if the
 * config does not ask for it at all.
 *
 * A key field's question key and its column are independent — the JSON says
 * where a question sits, `keyField` says which column it writes — so a screen
 * that needs to reach one particular answer must look it up rather than assume
 * the two are spelled the same.
 */
export function keyFieldKey(
  definition: ReferralFormDefinition,
  field: KeyFieldName,
): string | undefined {
  return keyFieldQuestions(definition).find((question) => question.field === field)?.key;
}

export function isDynamicQuestion(question: FormQuestion): question is DynamicQuestion {
  return question.type !== 'keyField' && question.type !== 'information';
}

export function isAnswerableQuestion(question: FormQuestion): question is AnswerableQuestion {
  return question.type !== 'information';
}

export function findQuestion(
  definition: ReferralFormDefinition,
  key: string,
): FormQuestion | undefined {
  return allQuestions(definition).find(
    (question): question is DynamicQuestion | KeyFieldQuestion =>
      'key' in question && question.key === key,
  );
}

/** The choices a question offers, once a runtime list has been fetched for the ones that need one. */
export function optionsFor(
  question: ChoiceQuestion,
  sources: Readonly<Partial<Record<ChoiceSource, readonly FormOption[]>>>,
): readonly FormOption[] {
  if (question.optionsFrom === undefined) return question.options;
  return sources[question.optionsFrom] ?? [];
}
