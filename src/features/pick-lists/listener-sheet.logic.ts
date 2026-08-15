import type { ListenerSheet } from './queries';
import { referralFormDefinition } from '../referrals/referral-form-config';
import type {
  FormQuestion,
  KeyFieldName,
  ReferralFormDefinition,
} from '../referrals/referral-form-definition';

type ListenerSheetHousehold = ListenerSheet['households'][number];

export interface ListenerColumn {
  readonly key: string;
  readonly label: string;
  readonly question: Exclude<FormQuestion, { type: 'information' }>;
}

/**
 * The fixed fields `GET /sessions/{id}/listener-sheet` actually sends, and how
 * each reads.
 *
 * **This map is the list of key fields the sheet can show.** The endpoint is a
 * deliberately narrow response — it is what keeps an address, a postcode, a
 * phone number and a date of birth off the one printed page that may carry a
 * reason for referral — so a question marked for this sheet whose field is not
 * here is left out rather than printed empty. That failure has happened three
 * times in this codebase already, each time as a column nobody noticed was
 * always blank.
 *
 * `reasonId` reads the reason's **label**: the form asks for a reason by id, and
 * the endpoint sends what it was called. A listener needs the words.
 */
const KEY_FIELD_READERS: Partial<
  Record<KeyFieldName, (household: ListenerSheetHousehold) => string | null>
> = {
  refereeFirstName: (household) => household.refereeFirstName,
  refereeSurname: (household) => household.refereeSurname,
  reasonId: (household) => household.reason,
  needsFuelHelp: (household) => (household.needsFuelHelp ? 'Yes' : 'No'),
};

/**
 * What the listener sheet shows, chosen by the referral form's
 * `forListenerSheet` marker and returned in the order the form asks the
 * questions.
 *
 * The charity decides what a listener needs to see by marking the questionnaire,
 * not by anybody editing this file — the same arrangement as the fuel help list
 * and the pick-list information, and for the same reason: a second list of keys
 * kept in the client drifts out of date silently, and the first symptom is a
 * volunteer holding a sheet with a blank column where the answer should be.
 */
export function listenerColumns(
  definition: ReferralFormDefinition = referralFormDefinition,
): ListenerColumn[] {
  return definition.pages.flatMap((page) =>
    page.questions.flatMap((question) => {
      if (question.type === 'information' || question.forListenerSheet !== true) return [];
      if (question.type === 'keyField' && KEY_FIELD_READERS[question.field] === undefined)
        return [];
      return [{ key: question.key, label: question.label, question }];
    }),
  );
}

/** One column's value, without reaching for an answer that carries no marker. */
export function listenerColumnValue(
  column: ListenerColumn,
  household: ListenerSheetHousehold,
): string {
  if (column.question.type === 'keyField') {
    return KEY_FIELD_READERS[column.question.field]?.(household) ?? 'Not provided';
  }
  return answerText(household.answers[column.key]);
}

/**
 * A listener reads this aloud to somebody, so an unanswered question says so in
 * words rather than leaving a gap that could be mistaken for a missing sheet.
 */
function answerText(answer: unknown): string {
  if (typeof answer === 'string') return answer.trim() === '' ? 'None given' : answer;
  if (Array.isArray(answer) && answer.every((item) => typeof item === 'string')) {
    return answer.length === 0 ? 'None given' : answer.join(', ');
  }
  if (typeof answer === 'number') return String(answer);
  return 'None given';
}
