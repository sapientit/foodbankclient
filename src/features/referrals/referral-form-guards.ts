import {
  dynamicQuestions,
  type DynamicQuestion,
  type FormFieldType,
  type ReferralFormDefinition,
} from './referral-form-definition';

/**
 * The two things about a form definition that nothing else in the system
 * would notice going wrong.
 *
 * The server validates none of this — `API.md` §3: "It is not validated
 * against anything... Required, max length, option lists and which questions
 * appear at all are your rules to enforce." So a definition that breaches the
 * server's storage bound, or that quietly repurposes a key, fails only here.
 * There is no other backstop.
 *
 * No React, no fetching, tested directly — against fixtures for the mechanics,
 * and against the real `referral-form.config.json` for the one assertion that
 * matters most: the charity's actual form fits inside the server's limits.
 *
 * The ledger these read is `referral-answer-keys.frozen.ts`.
 */

/** `ReferralSubmission.answers`: `maxProperties: 100`. */
export const MAX_ANSWER_KEYS = 100;

/** `ReferralSubmission.answers` keys: `maxLength: 60`. */
export const MAX_ANSWER_KEY_LENGTH = 60;

/** `ReferralSubmission.answers`: at most 16KB once serialised. */
export const MAX_ANSWERS_SERIALISED_BYTES = 16 * 1024;

/** A number question with no declared `maximum` still needs a worst case; a signed safe integer's longest decimal form. */
const UNBOUNDED_NUMBER_DIGIT_ESTIMATE = 20;

export type DefinitionProblem =
  | { readonly type: 'duplicate-key'; readonly key: string }
  | { readonly type: 'key-too-long'; readonly key: string }
  | { readonly type: 'too-many-questions'; readonly count: number }
  | { readonly type: 'answers-too-large'; readonly estimatedBytes: number };

/**
 * Everything about a definition the server's own limits would refuse, caught
 * before it ever reaches a referrer's submission. `answers-too-large` is a
 * worst-case estimate — every free-text answer at its `maxLength`, every
 * option field at its longest `value` — because the server counts the actual
 * JSON, and this has to bound it without one in hand. It is deliberately
 * conservative rather than exact: the point is to fail a review of the
 * definition, not to replicate the server's byte counter.
 */
export function checkDefinitionLimits(definition: ReferralFormDefinition): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const seen = new Set<string>();

  // Key fields are typed columns, not `answers` entries, so none of the
  // server's limits on the bag apply to them.
  const questions = dynamicQuestions(definition);

  for (const question of questions) {
    if (seen.has(question.key)) {
      problems.push({ type: 'duplicate-key', key: question.key });
    }
    seen.add(question.key);

    if (question.key.length > MAX_ANSWER_KEY_LENGTH) {
      problems.push({ type: 'key-too-long', key: question.key });
    }
  }

  if (questions.length > MAX_ANSWER_KEYS) {
    problems.push({ type: 'too-many-questions', count: questions.length });
  }

  const estimatedBytes = estimateWorstCaseSerialisedBytes(questions);
  if (estimatedBytes > MAX_ANSWERS_SERIALISED_BYTES) {
    problems.push({ type: 'answers-too-large', estimatedBytes });
  }

  return problems;
}

function estimateWorstCaseSerialisedBytes(questions: readonly DynamicQuestion[]): number {
  // Mirrors the shape of `JSON.stringify({ ...answers })`: braces around the
  // object, a quoted key, a colon, a value, and a comma per entry. Escaping
  // is ignored — this only needs to be conservative, not exact.
  let bytes = 2;
  for (const question of questions) {
    bytes += question.key.length + 2 + 1 + worstCaseValueBytes(question) + 1;
  }
  return bytes;
}

function worstCaseValueBytes(question: DynamicQuestion): number {
  switch (question.type) {
    case 'text':
      return question.maxLength + 2; // quoted string
    case 'number':
      return question.maximum === undefined
        ? UNBOUNDED_NUMBER_DIGIT_ESTIMATE
        : String(question.maximum).length;
    case 'choice': {
      /*
       * A question whose options arrive at runtime cannot be measured, which is
       * why `maxAnswerLength` is required for one — see `referral-form-config.ts`.
       * The fallback is only reached by a definition built in a test that
       * declared neither options nor a bound, and being wrong there is a
       * failing assertion rather than a referrer's rejected submission.
       */
      const longest =
        question.maxAnswerLength ??
        question.options.reduce((so_far, option) => Math.max(so_far, option.value.length), 0);
      const quoted = longest + 2;

      // A single-answer question stores the bare value; anything else stores a
      // JSON array — brackets, a comma between entries.
      return question.answerMax === 1
        ? quoted
        : 2 + question.answerMax * quoted + (question.answerMax - 1);
    }
  }
}

/** One entry per key a released definition has ever used. See `reusedKeys` and `unrecordedKeys`. */
export interface FrozenAnswerKey {
  readonly key: string;
  readonly type: FormFieldType;
}

/**
 * The only enforcement that an answer key was never quietly reused for a
 * different question — the server holds no form definition to compare
 * against, so this is a client-side ledger instead: every key a released
 * definition has ever used, frozen the moment it is added and never edited
 * afterwards, only appended to.
 *
 * **Adding a question:** add it to the live definition and to the ledger in
 * the same change — `unrecordedKeys` is what would notice if you forgot the
 * second half.
 *
 * **Removing a question** is safe and needs no ledger change: its answers
 * become "no longer asked" (`referral-answers.logic.ts`'s unknown-key case
 * for a live definition; simply absent going forward), and the ledger keeps
 * remembering the key was once a `type`.
 *
 * **Reusing a retired key for a new question of a different type** is what
 * this catches: the ledger says what the key used to mean, the live
 * definition says what it means now, and a mismatch is exactly the silent
 * meaning-change `CLAUDE.md` warns about. It cannot catch a same-typed
 * question reusing a key with a new meaning — two free-text questions are
 * indistinguishable by shape to any machine — so this is a safety net for the
 * mechanical slip, not a substitute for reading the diff on a form change.
 */
export function reusedKeys(
  history: readonly FrozenAnswerKey[],
  definition: ReferralFormDefinition,
): readonly string[] {
  const frozenTypeByKey = new Map(history.map((entry) => [entry.key, entry.type]));

  return dynamicQuestions(definition)
    .filter((question) => {
      const frozenType = frozenTypeByKey.get(question.key);
      return frozenType !== undefined && frozenType !== question.type;
    })
    .map((question) => question.key);
}

/**
 * Keys the live definition uses that the ledger has never recorded — run this
 * before releasing a form change, so a new question is never shipped without
 * also being frozen. An empty result does not mean the definition is safe by
 * itself; it means every key in it has a history to check `reusedKeys`
 * against.
 */
export function unrecordedKeys(
  history: readonly FrozenAnswerKey[],
  definition: ReferralFormDefinition,
): readonly string[] {
  const known = new Set(history.map((entry) => entry.key));
  return dynamicQuestions(definition)
    .filter((question) => !known.has(question.key))
    .map((question) => question.key);
}
