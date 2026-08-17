import { formatSessionDate } from '../../lib/london-time';

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
 * case to handle here; there is only "this session takes no deliveries".
 */
export interface DeliverySession {
  readonly sessionDate: string;
  readonly deliveryWindowStart: string;
  readonly deliveryWindowEnd: string;
  readonly deliveriesAllowed: boolean;
}

/**
 * What `$deliveryTime` reads as for the chosen session.
 *
 * A session with nobody to drive says so plainly rather than quoting a window
 * it cannot keep. **This does not stop the referral.** The charity settled on
 * 2026-08-16 that delivery stays on offer for such a session and submission is
 * not blocked: the referrer is then confirming, in as many words, that the
 * household will be at home for "No deliveries available for this session",
 * which is a conversation the food bank can have with them. Blocking it would
 * cost a validation path for one case and tell the referrer nothing about why
 * the option had vanished. The server does not refuse it either — an
 * administrator sorts it out at review.
 */
export function describeDeliveryWindow(session: DeliverySession): string {
  if (!session.deliveriesAllowed) return 'No deliveries available for this session';

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
