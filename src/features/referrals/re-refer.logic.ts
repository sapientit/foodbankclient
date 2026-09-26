import {
  dynamicQuestions,
  keyFieldQuestions,
  optionsFor,
  type FormPage,
  type KeyFieldName,
  type OptionSources,
  type ReferralFormDefinition,
} from './referral-form-definition';
import { defaultAnswers } from './referral-form-schema';
import type { AnswerValue, FormAnswers } from './referral-form.logic';
import { isHouseholdComposition } from './household-composition';
import { YES } from './referral-key-fields';

/**
 * What "Copy this referral" becomes once the referral form has changed since
 * the source was answered — see
 * `docs/planning/versioned-configuration-releases.md`, "Copying a referral
 * (admin only)", and `screenDetails.md`, "Copying a referral". The admin
 * reviews today's questionnaire, pre-filled with what cannot have changed,
 * rather than the client silently reinterpreting old answers under rules and
 * stock that may have moved on.
 *
 * No React, no fetching, tested directly.
 */

/**
 * Never editable here: the referrer is carried forward by the server from the
 * source referral, unquestioned, and is not a field on
 * `POST /referrals/{id}/re-refer` at all — see the server handoff addendum.
 * The session is excluded for a different reason: it is not one of the
 * "cannot have changed" fields `screenDetails.md` pre-fills, and this screen
 * offers it through the same warn-not-refuse picker Copy and Move already
 * use, not as an ordinary page question.
 */
const EXCLUDED_KEY_FIELDS: readonly KeyFieldName[] = [
  'referrerName',
  'referrerEmail',
  'referrerOrganisation',
  'referrerPhone',
  'sessionId',
];

const CARRIED_KEY_FIELDS = [
  'refereeFirstName',
  'refereeSurname',
  'refereeDateOfBirth',
  'refereeAddress',
  'refereePostcode',
  'refereePhone',
  'reasonId',
  'needsFuelHelp',
] as const;

type CarriedKeyField = (typeof CARRIED_KEY_FIELDS)[number];

function isCarriedKeyField(field: KeyFieldName): field is CarriedKeyField {
  return (CARRIED_KEY_FIELDS as readonly string[]).includes(field);
}

/**
 * The fixed fields this screen reads off the source referral. Deliberately
 * not the generated `Referral` type — this is a `.logic.ts`, and
 * `.claude/rules/api-contract.md` keeps the import boundary structural.
 * Never the referrer: see `EXCLUDED_KEY_FIELDS`.
 */
export interface ReReferSource {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly refereeFirstName: string | null;
  readonly refereeSurname: string | null;
  readonly refereeDateOfBirth: string | null;
  readonly refereeAddress: string | null;
  readonly refereePostcode: string | null;
  readonly refereePhone: string | null;
  readonly needsFuelHelp: boolean;
  readonly reasonId: string;
}

function carriedKeyFieldValue(
  source: ReReferSource,
  field: CarriedKeyField,
  activeReasonIds: ReadonlySet<string>,
): string {
  switch (field) {
    case 'refereeFirstName':
      return source.refereeFirstName ?? '';
    case 'refereeSurname':
      return source.refereeSurname ?? '';
    case 'refereeDateOfBirth':
      return source.refereeDateOfBirth ?? '';
    case 'refereeAddress':
      return source.refereeAddress ?? '';
    case 'refereePostcode':
      return source.refereePostcode ?? '';
    case 'refereePhone':
      return source.refereePhone ?? '';
    case 'needsFuelHelp':
      return source.needsFuelHelp ? YES : '';
    case 'reasonId':
      // The same "still offered" test as a dynamic choice answer, applied to
      // a key field that also draws from a maintained list: a reason retired
      // since the source referral was made is left blank rather than
      // pre-selecting an option the dropdown no longer offers.
      return activeReasonIds.has(source.reasonId) ? source.reasonId : '';
  }
}

/**
 * Today's questionnaire, with the fields this screen never asks removed —
 * see `EXCLUDED_KEY_FIELDS`. A page left with nothing else on it is dropped
 * rather than shown empty.
 */
export function reReferPages(definition: ReferralFormDefinition): readonly FormPage[] {
  return definition.pages
    .map((page) => ({
      ...page,
      questions: page.questions.filter(
        (question) => question.type !== 'keyField' || !EXCLUDED_KEY_FIELDS.includes(question.field),
      ),
    }))
    .filter((page) => page.questions.length > 0);
}

/**
 * The form pre-filled with what cannot have changed. Every fixed field
 * except the session; a stored dynamic answer only where its key still
 * exists on today's form and, for a choice, at least one of its values is
 * still offered. Everything else is left exactly as blank as a question this
 * household was never asked — there is no partial-copy heuristic to get
 * right, because the admin resolves anything ambiguous by looking at the
 * current question and answering it.
 */
export function buildReReferInitialAnswers(
  source: ReReferSource,
  definition: ReferralFormDefinition,
  sources: OptionSources,
): FormAnswers {
  const activeReasonIds = new Set((sources.referralReasons ?? []).map((option) => option.value));
  const answers: Record<string, AnswerValue> = { ...defaultAnswers(definition) };

  for (const question of keyFieldQuestions(definition)) {
    if (!isCarriedKeyField(question.field)) continue;
    answers[question.key] = carriedKeyFieldValue(source, question.field, activeReasonIds);
  }

  for (const question of dynamicQuestions(definition)) {
    const stored = source.answers[question.key];
    if (stored === undefined) continue;

    if (question.type === 'choice') {
      const chosen: readonly string[] =
        typeof stored === 'string'
          ? [stored]
          : Array.isArray(stored)
            ? stored.filter((value): value is string => typeof value === 'string')
            : [];
      const offered = new Set(optionsFor(question, sources).map((option) => option.value));
      const stillOffered = chosen.filter((value) => offered.has(value));
      if (stillOffered.length > 0) answers[question.key] = stillOffered;
      continue;
    }

    if (question.type === 'householdComposition') {
      if (isHouseholdComposition(stored)) answers[question.key] = stored;
      continue;
    }

    if (question.type === 'number') {
      answers[question.key] =
        typeof stored === 'number' ? String(stored) : typeof stored === 'string' ? stored : '';
      continue;
    }

    if (typeof stored === 'string') answers[question.key] = stored;
  }

  return answers;
}
