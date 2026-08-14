import { describeAnswers } from '../referrals/referral-answers.logic';
import { referralFormDefinition } from '../referrals/referral-form-config';
import {
  dynamicQuestions,
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
 * Builds the parcel snapshot from the questions the reviewed form
 * configuration explicitly marks for pick-list information. The server never
 * sees form keys or answers: it receives only this finished, human-readable
 * annotation when it creates a new parcel.
 */
export function buildPickListInformation(
  referrals: readonly PickListInformationSource[],
  definition: ReferralFormDefinition = referralFormDefinition,
): PickListInformation[] {
  const configured = dynamicQuestions(definition).flatMap((question) =>
    question.pickListInformation !== true ? [] : [{ key: question.key, label: question.key }],
  );

  return referrals.flatMap((referral) => {
    const rendered = describeAnswers(definition, { answers: referral.answers, piiPurgedAt: null });
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
