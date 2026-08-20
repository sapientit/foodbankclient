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
 * referrer may ask for**: whether a delivery can still be had from it.
 *
 * This takes a `DeliveryStanding` rather than a session, because **the two
 * audiences do not know the same thing** and that difference is load-bearing.
 * A referrer's `PublicSession` carries `deliveryAvailability` and can tell all
 * three apart; a staff `Session` carries `deliveryCapacity` — the number an
 * administrator set — and **no count of deliveries booked against it**, so it
 * can never say `full`. Mapping at the call site is what keeps that visible
 * instead of hiding it behind an overload that silently answers wrong.
 *
 * No React, no fetching, tested directly.
 */

/**
 * Whether a delivery can be had from this session, as the person reading it can
 * tell. `open` covers "there is still room" and is the ordinary case.
 */
export type DeliveryStanding = 'none' | 'full' | 'open';

/** Nobody is driving this session at all. */
export const COLLECTION_ONLY = 'Collection Only';

/**
 * The session delivers, but its delivery places have all gone.
 *
 * Deliberately close to the referral form's `No deliveries available for this
 * session`, which means the *other* one — see `delivery-window.logic.ts`. Pete
 * accepted the near-collision on 2026-08-19: a referrer reads one of them in a
 * dropdown and the other beside a confirmation, never the two together, and
 * both answer the only question being asked, which is whether this session can
 * deliver.
 */
export const NO_DELIVERIES = 'No deliveries';

/**
 * The words a session carries about deliveries, or `null` where it delivers as
 * usual.
 *
 * `null` rather than `''` so a caller has to decide what an absent label
 * renders as: a dropdown option leaves it out of the sentence entirely, and a
 * column layout leaves the cell empty so the columns still line up. Collection
 * is the ordinary case and saying so on every row would be the noise the
 * location used to be.
 */
export function deliveryLabel(standing: DeliveryStanding): string | null {
  if (standing === 'none') return COLLECTION_ONLY;
  if (standing === 'full') return NO_DELIVERIES;
  return null;
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
export function describeSessionChoice(when: string, standing: DeliveryStanding): string {
  const label = deliveryLabel(standing);
  return label === null ? when : `${when}, ${label}`;
}

/**
 * What a staff screen can say from a `Session`.
 *
 * **Never `full`, and that is a limit of the contract rather than an
 * oversight.** `Session` carries `deliveryCapacity` but no count of the
 * deliveries booked against it, so an administrator's table cannot tell a
 * session whose places have gone from one with places left. If the charity
 * wants that column to say so, the server has to send the count first.
 */
export function standingFromCapacity(deliveryCapacity: number): DeliveryStanding {
  return deliveryCapacity === 0 ? 'none' : 'open';
}
