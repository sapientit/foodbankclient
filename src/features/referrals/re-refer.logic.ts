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
import {
  COLLECTION_METHOD_KEY,
  DELIVERY_REQUESTED,
  REFERRER_WILL_COLLECT,
  type CollectionMethod,
} from './referral-submission.logic';

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
 *
 * **The session stays in.** It used to be excluded and offered through a
 * bolted-on picker after the last page instead, but it is not one of the
 * "cannot have changed" fields `screenDetails.md` pre-fills either — it is an
 * ordinary required `keyField` question like any other, and belongs in
 * whatever page position the config gives it. `re-refer-screen.tsx`'s
 * `SessionField` still renders it from the admin session list rather than the
 * public one, so it carries real booked/capacity numbers and the same
 * warn-not-refuse note Copy and Move give; only its source and that note are
 * this screen's own, not its place on the page.
 */
const EXCLUDED_KEY_FIELDS: readonly KeyFieldName[] = [
  'referrerName',
  'referrerEmail',
  'referrerOrganisation',
  'referrerPhone',
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
  readonly collectionMethod: CollectionMethod;
}

/**
 * `collectionMethodForAnswer` collapses "Car", "Public Transport" and "On
 * Foot" into the same `'collection'` column at submission time, so which of
 * those three the source referral actually chose is gone, not merely
 * unrendered here — it is left blank like any other answer with no obvious
 * match on today's form. Delivery and referrer-collect are the one-to-one
 * inverse of `collectionMethodForAnswer` and can be carried forward exactly.
 */
function collectionMethodStoredAnswer(collectionMethod: CollectionMethod): string | undefined {
  if (collectionMethod === 'delivery') return DELIVERY_REQUESTED;
  if (collectionMethod === 'referrer_collect') return REFERRER_WILL_COLLECT;
  return undefined;
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
 *
 * "Collection method" reads from `source.answers` like any other dynamic
 * question, so a referral submitted new carries its exact answer forward
 * (still subject to the "still offered" check below). A referral submitted
 * before `splitSubmission` started storing that answer alongside the typed
 * `collectionMethod` column has no answer to read there, so
 * `collectionMethodStoredAnswer` reconstructs what it can from that column —
 * which cannot say "Car" from "Public Transport" from "On Foot", all three
 * having collapsed into the same value, so a plain collection stays blank.
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
    const fromAnswers = source.answers[question.key];
    const stored =
      question.key === COLLECTION_METHOD_KEY && fromAnswers === undefined
        ? collectionMethodStoredAnswer(source.collectionMethod)
        : fromAnswers;
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
