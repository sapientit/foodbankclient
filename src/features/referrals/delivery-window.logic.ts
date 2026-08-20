import { formatSessionDate } from '../../lib/london-time';
import {
  allQuestions,
  type ChoiceQuestion,
  type ReferralFormDefinition,
} from './referral-form-definition';

/**
 * The sentence a referrer is shown about when a delivery would arrive, and the
 * substitution that puts it into a question written in the charity's config.
 *
 * **Why a variable rather than a hand-written line on the screen.** The form is
 * driven entirely by `referral-form.config.json` — a question that renders from
 * anywhere else is one the validation and the submission split do not know
 * about. The charity wanted to ask a referrer to confirm the household will be
 * at home for the delivery, which means the question has to name a window the
 * config cannot know at build time. So the config writes `$deliveryTime` and
 * this resolves it against the chosen session.
 *
 * No React, no fetching, tested directly.
 */

/** The token the config writes. Settled with Pete on 2026-08-16, along with the two sentences below. */
export const DELIVERY_TIME_VARIABLE = '$deliveryTime';

/**
 * The label the window is announced under, bold on the screen.
 *
 * Settled with Pete on 2026-08-16: a plain sentence sitting among the questions
 * was too easily read past, and this is the one line the second delivery
 * confirmation is about. A label the eye can find is worth more here than a
 * sentence that scans well.
 */
export const DELIVERY_TIME_LABEL = 'Delivery Time:';

/**
 * The window as the referral form states it.
 *
 * **`PublicSession` carries the *resolved* window, never null** — a session
 * that sets none of its own reports its own hours, the server having done that
 * fallback once rather than in every client. So there is no "no window set"
 * case to handle here; there are only the two ways a delivery cannot be had.
 */
export interface DeliverySession {
  readonly sessionDate: string;
  readonly deliveryWindowStart: string;
  readonly deliveryWindowEnd: string;
  readonly deliveryAvailability: 'not_offered' | 'full' | 'available';
}

/** Where the session has nobody to drive at all. */
export const NO_DELIVERIES_OFFERED = 'No deliveries available for this session';

/** Where it does deliver, but every delivery place has gone. */
export const NO_DELIVERY_SLOTS_LEFT = 'No delivery slots available for this session';

/**
 * What `$deliveryTime` reads as for the chosen session: the window, or which of
 * the two reasons there is no window to quote.
 *
 * **This states the position; it does not enforce it.** The food bank now
 * refuses a delivery to a session that takes none and to one whose delivery
 * places have gone — a `409` on submission, the same hard stop as a session at
 * its overall capacity. Settled by Pete on 2026-08-19, reversing the earlier
 * position that an administrator sorted it out at review.
 *
 * **The form still does not check any of that before submitting, and that is a
 * decision rather than an omission.** A referrer choosing the session has
 * already read this line, so a second refusal from the form would tell them
 * nothing they were not told here; and the only case a check could catch is the
 * race — the last delivery place going between this line being read and the
 * form being sent — which no client-side check can win anyway. Delivery stays
 * offered, the referral is still sent, and the refusal that matters comes from
 * the one place that can be sure of it. See `public-referral-screen.tsx` for
 * what a referrer meets when it does.
 */
export function describeDeliveryWindow(session: DeliverySession): string {
  if (session.deliveryAvailability === 'not_offered') return NO_DELIVERIES_OFFERED;
  if (session.deliveryAvailability === 'full') return NO_DELIVERY_SLOTS_LEFT;

  return `between ${session.deliveryWindowStart} and ${session.deliveryWindowEnd} on ${formatSessionDate(session.sessionDate)}`;
}

/** The values a question's text may draw on. A `null` means "not known yet". */
export interface FormVariables {
  readonly deliveryTime?: string | null;
}

/**
 * A run of a question's text, and whether it stands out.
 *
 * Substitution produces runs rather than one string because the delivery line
 * is a bold label followed by the window in ordinary text, and a string cannot
 * carry that. Every other question resolves to a single ordinary run, so the
 * caller renders one shape.
 */
export interface TextSegment {
  readonly text: string;
  readonly emphasis: boolean;
}

const ordinary = (text: string): readonly TextSegment[] =>
  text === '' ? [] : [{ text, emphasis: false }];

/**
 * A question's text with its variables filled in, or `null` where one of them
 * has no value yet.
 *
 * **`null` means render nothing, never render the token.** A referrer who sees
 * the literal `$deliveryTime` learns that the form is broken; one who sees a
 * line appear when they pick a session learns what the form is asking. The
 * caller for this is the referral question field, which already returns nothing
 * for an informational row whose condition does not apply — an unresolved
 * variable is the same situation arriving a different way.
 *
 * Text with no variable in it comes back unchanged, which is every other
 * question on the form.
 *
 * The delivery time arrives as `DELIVERY_TIME_LABEL` in bold and the window
 * after it, so the line reads as a heading a referrer can find rather than one
 * more sentence to skim past.
 */
export function applyFormVariables(
  text: string,
  variables: FormVariables,
): readonly TextSegment[] | null {
  if (!text.includes(DELIVERY_TIME_VARIABLE)) return ordinary(text);

  const deliveryTime = variables.deliveryTime;
  if (deliveryTime === undefined || deliveryTime === null) return null;

  return text
    .split(DELIVERY_TIME_VARIABLE)
    .flatMap((between, index) =>
      index === 0
        ? ordinary(between)
        : [
            { text: DELIVERY_TIME_LABEL, emphasis: true },
            ...ordinary(` ${deliveryTime}`),
            ...ordinary(between),
          ],
    );
}

/**
 * Whether a refusal was the delivery one — the `409` raised because a
 * session's delivery places are gone, which includes a session that takes no
 * deliveries at all.
 *
 * **Read from `details`, never from the message.** Five causes share
 * `409 CONFLICT` on this endpoint; `openapi.yaml` documents a sentence for
 * each and puts `details` on two of them, and the sentences are the food
 * bank's to reword whenever it likes. A client that matched on the wording
 * would quietly stop doing this the day one changed, with no test failing
 * anywhere — so the structural key is the only thing read here. The capacity
 * refusal carries `capacity`; this one carries `deliveryCapacity`.
 */
export function refusedForDeliveryPlaces(
  details: Readonly<Record<string, unknown>> | null,
): boolean {
  return details !== null && Object.hasOwn(details, 'deliveryCapacity');
}

/** Where a confirmation lives, and the one answer within it that is about the window. */
export interface WindowConfirmation {
  readonly key: string;
  readonly value: string;
}

/**
 * The tick that says the household will be at home for the delivery window,
 * found from the config rather than named here.
 *
 * A delivery takes two confirmations together and **only the second is about
 * the session**: the first is a fact about the household, true whichever
 * session it is on. So the second is the one a refusal invalidates, and the
 * first must survive — making a referrer re-answer something that was never
 * wrong is how a form teaches people to tick without reading.
 *
 * **Derived, because the questionnaire is the charity's and this screen does
 * not get to name its questions.** The `$deliveryTime` line already carries
 * the condition under which a delivery is being asked about; the confirmation
 * is the answerable question standing under the same condition, and the answer
 * about the window is the second one the charity wrote. Nothing here is keyed
 * on a question id or on the wording of an option.
 *
 * `null` where the config has no such pair — a form that does not ask for the
 * confirmation has nothing to reset, and that is not an error.
 */
export function deliveryWindowConfirmation(
  definition: ReferralFormDefinition,
): WindowConfirmation | null {
  const line = allQuestions(definition).find(
    (question) =>
      question.type === 'information' && question.label.includes(DELIVERY_TIME_VARIABLE),
  );
  const gate = line?.enabledWhen;
  if (gate === undefined) return null;

  const confirmation = allQuestions(definition).find(
    (question): question is ChoiceQuestion =>
      question.type === 'choice' &&
      question.enabledWhen?.questionKey === gate.questionKey &&
      question.enabledWhen.hasAnswer === gate.hasAnswer,
  );

  const window = confirmation?.options[1];
  if (confirmation === undefined || window === undefined) return null;

  return { key: confirmation.key, value: window.value };
}
