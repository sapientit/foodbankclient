import type { ListenerSheet } from './queries';
import { referralFormDefinition } from '../referrals/referral-form-config';
import { optionsFor } from '../referrals/referral-form-definition';
import type {
  FormOption,
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

/**
 * Whether any column takes its options from a server lookup, and so needs one
 * fetching before the sheet can be printed. Today that is the secondary cause
 * of crisis and nothing else, but the marker is the charity's to move.
 */
export function listenerColumnsNeedReferralReasons(columns: readonly ListenerColumn[]): boolean {
  return columns.some(
    (column) => column.question.type === 'choice' && column.question.optionsFrom !== undefined,
  );
}

/**
 * One column's value, without reaching for an answer that carries no marker.
 *
 * `referralReasons` is the maintained reason lookup, as options. A question
 * choosing from it stores the reason's **id**, so without the lookup this sheet
 * prints an identifier at somebody who is about to read it aloud — the reason
 * the secondary cause of crisis is passed a list rather than rendered raw.
 */
export function listenerColumnValue(
  column: ListenerColumn,
  household: ListenerSheetHousehold,
  referralReasons: readonly FormOption[],
): string {
  if (column.question.type === 'keyField') {
    return KEY_FIELD_READERS[column.question.field]?.(household) ?? 'Not provided';
  }

  const answer = household.answers[column.key];
  if (column.question.type === 'choice' && column.question.optionsFrom !== undefined) {
    return optionText(optionsFor(column.question, { referralReasons }), answer);
  }
  return answerText(answer);
}

/**
 * A stored option read back as the words the charity gave it.
 *
 * A single-answer choice stores the bare value and a multi-answer one stores an
 * array, so both shapes arrive here — see `.claude/rules/referral-form.md`.
 *
 * **A guess, marked as Q37 in the server's `OPEN-QUESTIONS.md`:** an id matching nothing in the
 * lookup prints as "No longer listed". `GET /public/referral-reasons` sends the
 * active reasons only, so a referral naming a reason retired since it was made
 * cannot be resolved by a team lead — and printing the id, or "None given" for
 * a question that *was* answered, are both worse than saying so.
 */
function optionText(options: readonly FormOption[], answer: unknown): string {
  const stored = typeof answer === 'string' ? [answer] : answer;
  if (!Array.isArray(stored)) return 'None given';

  const chosen = stored.filter(
    (entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  if (chosen.length === 0) return 'None given';

  return chosen
    .map((entry) => options.find((option) => option.value === entry)?.label ?? 'No longer listed')
    .join(', ');
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
