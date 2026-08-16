/**
 * How a session is named to somebody choosing one or reading which one they
 * are on.
 *
 * **The location is deliberately absent.** The charity runs from one hall, so
 * naming it on every row and every dropdown option was a column of the same
 * word repeated — it pushed the parts that do differ off the edge of a phone
 * without telling anybody anything. Settled by Pete on 2026-08-16. If the food
 * bank ever runs from two places this has to come back, and it comes back here
 * rather than in the six screens that used to spell it out separately.
 *
 * **What replaces it is the one thing about a session that changes what a
 * referrer may ask for**: whether it takes deliveries. A session with nobody to
 * drive is collection only, and that is worth a column where the hall's name
 * never was.
 *
 * Structural parameter types, not the generated `Session`, so this stays a
 * pure module that both a staff screen and the public form can use — the
 * generated types satisfy them, and `PublicSession` (which has no `capacity`
 * or `booked`) satisfies the narrow ones.
 *
 * No React, no fetching, tested directly.
 */

/** Shown only when a session takes no deliveries; there is no opposite label, because collection is the ordinary case and saying so on every row is noise. */
export const COLLECTION_ONLY = 'Collection Only';

export interface DeliveryCapability {
  readonly deliveriesAllowed: boolean;
}

/**
 * `Collection Only`, or `null` where the session takes deliveries as usual.
 *
 * `null` rather than `''` so a caller has to decide what an absent label
 * renders as: a dropdown option leaves it out of the sentence entirely, and a
 * column layout leaves the cell empty so the columns still line up.
 */
export function collectionOnlyLabel(session: DeliveryCapability): string | null {
  return session.deliveriesAllowed ? null : COLLECTION_ONLY;
}

/**
 * A session as one line of text, for a dropdown option or a link — somewhere a
 * person is picking one session out of several.
 *
 * The caller supplies the date and time already formatted, because the two
 * differ by audience and that difference is load-bearing: the public form
 * shows a start time and **never an end time**, since a wrong closing time
 * sends somebody to a locked hall. Keeping that decision at the call site is
 * what stops this function quietly standardising it away.
 */
export function describeSessionChoice(when: string, session: DeliveryCapability): string {
  const label = collectionOnlyLabel(session);
  return label === null ? when : `${when}, ${label}`;
}
