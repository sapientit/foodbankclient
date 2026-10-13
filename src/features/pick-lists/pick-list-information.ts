import { describeAnswers } from '../referrals/referral-answers.logic';
import { referralFormDefinition } from '../referrals/referral-form-config';
import {
  dynamicQuestions,
  needsOptionSources,
  type OptionSources,
  type ReferralFormDefinition,
} from '../referrals/referral-form-definition';

export interface PickListInformation {
  readonly referralId: string;
  readonly notes: string;
}

/** The three parts of a parcel the Information for pickers is composed from. */
export interface PickerInformationSource {
  /** The referral's pick list admin notes, as they read now. */
  readonly picklistAdmin: string | null;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Only the `No longer stocked: …` line written at generation, or `null`. */
  readonly notes: string | null;
}

/**
 * The questions the reviewed form configuration explicitly marks for
 * pick-list information. Exported so a caller can ask `needsOptionSources`
 * about them: the composed text is printed, so a marked question that chooses
 * from a server lookup would put an id on a picking sheet.
 */
export function pickListInformationQuestions(
  definition: ReferralFormDefinition = referralFormDefinition,
) {
  return dynamicQuestions(definition).filter((question) => question.pickListInformation === true);
}

/** Whether the marked questions need a lookup fetching before the text can be composed. */
export function pickListInformationNeedsOptionSources(
  definition: ReferralFormDefinition = referralFormDefinition,
): boolean {
  return needsOptionSources(pickListInformationQuestions(definition));
}

/**
 * What is written onto a parcel at generation: **only** the `No longer
 * stocked: …` line, for a referral whose historic release named an item
 * `resolveHistoricPreferenceLines` could not resolve. See
 * `docs/planning/versioned-configuration-releases.md`, "Historic unavailable
 * stock": that note is the only record of the drop, so it is the one part of
 * the Information for pickers that is stored rather than composed.
 */
export function buildPickListInformation(
  unavailableStockByReferralId: ReadonlyMap<string, readonly string[]>,
): PickListInformation[] {
  return [...unavailableStockByReferralId].flatMap(([referralId, unavailable]) =>
    unavailable.length === 0
      ? []
      : [
          {
            referralId,
            notes: `No longer stocked: ${[...new Set(unavailable)].sort().join(', ')}.`,
          },
        ],
  );
}

/**
 * A parcel's Information for pickers, composed afresh every time it is shown
 * or printed — `screenDetails.md`, "The printed picking sheet". Three parts,
 * each on its own line and each left out when empty: the referral's pick list
 * admin notes, a `key: value` line for each answer the parcel's **own** form
 * release marks for pick-list information, and the stored "No longer stocked"
 * note. A completed session still reads as it was printed because the server
 * locks all three once the session is confirmed.
 *
 * `definition` is `null` where the parcel's release is unknown: no marked
 * answers can be identified, the same fallback generation has always used.
 * `null` when there is nothing to say at all.
 *
 * Never the reason for referral, nor any answer the form does not mark.
 */
export function composeInformationForPickers(
  parcel: PickerInformationSource,
  definition: ReferralFormDefinition | null,
  sources: OptionSources,
): string | null {
  const admin = parcel.picklistAdmin?.trim() ?? '';
  const marked = definition === null ? [] : markedAnswerLines(parcel, definition, sources);
  const stored = parcel.notes?.trim() ?? '';
  const parts = [admin, ...marked, stored].filter((part) => part !== '');
  return parts.length === 0 ? null : parts.join('\n');
}

function markedAnswerLines(
  parcel: Pick<PickerInformationSource, 'answers'>,
  definition: ReferralFormDefinition,
  sources: OptionSources,
): string[] {
  const rendered = describeAnswers(definition, { answers: parcel.answers }, sources);
  if (rendered.kind !== 'answers') return [];
  const values = new Map(rendered.lines.map((line) => [line.key, line.value.trim()]));
  return pickListInformationQuestions(definition).flatMap((question) => {
    const value = values.get(question.key);
    return value === undefined || value === '' || value === '(no answer)'
      ? []
      : [`${question.key}: ${value}`];
  });
}
