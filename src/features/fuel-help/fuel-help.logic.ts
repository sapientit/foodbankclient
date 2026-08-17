import type { FuelHelpList } from './queries';
import { formatCalendarDate } from '../../lib/london-time';
import { referralFormDefinition } from '../referrals/referral-form-config';
import { needsOptionSources, optionsFor } from '../referrals/referral-form-definition';
import type {
  FormQuestion,
  KeyFieldName,
  OptionSources,
  ReferralFormDefinition,
} from '../referrals/referral-form-definition';

type FuelHelpHousehold = FuelHelpList['households'][number];

export interface FuelColumn {
  readonly key: string;
  readonly label: string;
  readonly question: Exclude<FormQuestion, { type: 'information' }>;
}

/**
 * The fixed fields `GET /fuel-help-list` actually sends, and how each reads.
 *
 * **This map is the list of key fields the screen can show, and that is on
 * purpose.** The marker lives on the referral form while the endpoint decides
 * what it sends, so the two can disagree — `needsFuelHelp` was marked and
 * withheld for a while, and the column sat there reading "Not provided" on
 * every row of every extract without anybody noticing. Anything absent here is
 * left out of the table rather than rendered empty, so adding a field to the
 * response is one entry and forgetting one cannot produce a dead column.
 *
 * Deliberately not derived from eligibility or from another answer: a household
 * is on this list *because* it needs fuel help, so inventing a value from that
 * would turn a missing field into a claim about them.
 */
const KEY_FIELD_READERS: Partial<
  Record<KeyFieldName, (household: FuelHelpHousehold) => string | null>
> = {
  refereeFirstName: (household) => household.refereeFirstName,
  refereeSurname: (household) => household.refereeSurname,
  // A calendar date, so formatted in UTC — see `formatCalendarDate`. The fuel
  // team gets it to tell two households of the same name apart, which is also
  // why it is a date and never an age.
  refereeDateOfBirth: (household) =>
    household.refereeDateOfBirth === null ? null : formatCalendarDate(household.refereeDateOfBirth),
  refereeAddress: (household) => household.refereeAddress,
  refereePostcode: (household) => household.refereePostcode,
  refereePhone: (household) => household.refereePhone,
};

/**
 * The referral form owns which personal details the fuel team is permitted to
 * see. Keeping the selection here derived from its marker means a released
 * fuel question appears in this copy-to-Excel list without a second list of
 * keys drifting out of date.
 *
 * A marked key field the endpoint does not return is skipped; see
 * `KEY_FIELD_READERS`.
 */
export function fuelColumns(
  definition: ReferralFormDefinition = referralFormDefinition,
): FuelColumn[] {
  return definition.pages.flatMap((page) =>
    page.questions.flatMap((question) => {
      if (question.type === 'information' || question.forFuelTeam !== true) return [];
      if (question.type === 'keyField' && KEY_FIELD_READERS[question.field] === undefined)
        return [];
      return [{ key: question.key, label: question.label, question }];
    }),
  );
}

/** Whether any column's answer was chosen from a server lookup, and so needs one fetching. */
export function fuelColumnsNeedOptionSources(columns: readonly FuelColumn[]): boolean {
  return needsOptionSources(columns.map((column) => column.question));
}

/**
 * Formats one configured fuel column without exposing answers that lack the
 * marker.
 *
 * `sources` carries the maintained lookups: a question choosing from one stored
 * the option's id, and this list is copied into a spreadsheet and worked from.
 */
export function fuelColumnValue(
  column: FuelColumn,
  household: FuelHelpHousehold,
  sources: OptionSources,
): string {
  if (column.question.type === 'keyField') {
    return KEY_FIELD_READERS[column.question.field]?.(household) ?? 'Not provided';
  }

  const answer = household.answers[column.key];
  if (column.question.type === 'choice' && column.question.optionsFrom !== undefined) {
    return optionText(optionsFor(column.question, sources), answer);
  }
  return answerText(answer);
}

/** A stored option as the words the charity gave it — see `listener-sheet.logic.ts`. */
function optionText(
  options: readonly { readonly value: string; readonly label: string }[],
  answer: unknown,
): string {
  const stored = typeof answer === 'string' ? [answer] : answer;
  if (!Array.isArray(stored)) return 'Not answered';

  const chosen = stored.filter(
    (entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  if (chosen.length === 0) return 'Not answered';

  return chosen
    .map((entry) => options.find((option) => option.value === entry)?.label ?? 'No longer listed')
    .join(', ');
}

function answerText(answer: unknown): string {
  if (typeof answer === 'string') return answer.trim() === '' ? 'Not answered' : answer;
  if (Array.isArray(answer) && answer.every((item) => typeof item === 'string')) {
    return answer.length === 0 ? 'Not answered' : answer.join(', ');
  }
  if (typeof answer === 'number') return String(answer);
  return 'Not answered';
}
