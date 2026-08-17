import { describeAnswers } from '../referrals/referral-answers.logic';
import { referralFormDefinition } from '../referrals/referral-form-config';
import {
  dynamicQuestions,
  needsOptionSources,
  type OptionSources,
  type ReferralFormDefinition,
} from '../referrals/referral-form-definition';

export interface PickListInformationSource {
  readonly id: string;
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface PickListInformation {
  readonly referralId: string;
  readonly notes: string;
}

/**
 * The questions this snapshot is built from — the ones the reviewed form
 * configuration explicitly marks for pick-list information. Exported so a
 * caller can ask `needsOptionSources` about them: the notes are saved on the
 * parcel and printed, so a marked question that chooses from a server lookup
 * would put an id on a picking sheet permanently.
 */
export function pickListInformationQuestions(
  definition: ReferralFormDefinition = referralFormDefinition,
) {
  return dynamicQuestions(definition).filter((question) => question.pickListInformation === true);
}

/** Whether the marked questions need a lookup fetching before the notes can be composed. */
export function pickListInformationNeedsOptionSources(
  definition: ReferralFormDefinition = referralFormDefinition,
): boolean {
  return needsOptionSources(pickListInformationQuestions(definition));
}

/**
 * Builds the parcel snapshot from the questions the reviewed form
 * configuration explicitly marks for pick-list information. The server never
 * sees form keys or answers: it receives only this finished, human-readable
 * annotation when it creates a new parcel.
 */
export function buildPickListInformation(
  referrals: readonly PickListInformationSource[],
  sources: OptionSources,
  definition: ReferralFormDefinition = referralFormDefinition,
): PickListInformation[] {
  const configured = pickListInformationQuestions(definition).map((question) => ({
    key: question.key,
    label: question.key,
  }));

  return referrals.flatMap((referral) => {
    const rendered = describeAnswers(
      definition,
      { answers: referral.answers, piiPurgedAt: null },
      sources,
    );
    if (rendered.kind !== 'answers') return [];
    const values = new Map(rendered.lines.map((line) => [line.key, line.value.trim()]));
    const notes = configured
      .flatMap(({ key, label }) => {
        const value = values.get(key);
        return value === undefined || value === '' || value === '(no answer)'
          ? []
          : [`${label}: ${value}`];
      })
      .join('\n');

    return notes === '' ? [] : [{ referralId: referral.id, notes }];
  });
}
