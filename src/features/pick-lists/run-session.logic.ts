import type { SessionStatus } from '../sessions/keys';
import type { Parcel } from './queries';

/**
 * Whether a session is finished with, and every run-session screen is therefore
 * a record of what happened rather than a place to change it.
 *
 * **One named rule, threaded as a boolean.** The screens used to pass
 * `sessionStatus` around and compare it to `'confirmed'` in five places; each
 * of those was a place to forget the second status. A cancelled session is
 * frozen for a different reason — it is not being run — but the screens treat
 * it identically, and the server refuses the same writes either way.
 *
 * **The controls are absent, not disabled.** After
 * `POST /sessions/{id}/confirm` every write behind these screens is a `409` with
 * no override, and `API.md` is explicit that a screen should make that
 * impossible rather than let somebody attempt it and be refused. A greyed-out
 * button on a session from three weeks ago is an invitation to wonder what is
 * wrong with the app.
 *
 * No React, no fetching, tested directly.
 */
export function isSessionReadOnly(status: SessionStatus): boolean {
  return status === 'confirmed' || status === 'cancelled';
}

/**
 * Why the screen cannot be changed, in one sentence, or `null` while it can.
 *
 * The two reasons are genuinely different and a team lead deserves to be told
 * which: a confirmed session has been signed off and its stock figures must not
 * move, a cancelled one never ran at all.
 */
export function describeReadOnlySession(status: SessionStatus): string | null {
  if (status === 'confirmed') {
    return 'This session has been completed and signed off. It is shown as a record of what happened and cannot be changed.';
  }
  if (status === 'cancelled') {
    return 'This session was cancelled, so it did not run and nothing on it can be changed.';
  }
  return null;
}

/** A delivery is attended by being delivered, and missed by nobody being in. */
export function attendedLabel(parcel: Parcel): string {
  return parcel.isDelivery ? 'Delivered' : 'Attended';
}

export function missedLabel(parcel: Parcel): string {
  return parcel.isDelivery ? 'Not in' : 'No show';
}

/**
 * How far along a client is, as the word the client list shows and a state the
 * badge is drawn from.
 *
 * **The four words are `screenDetails.md`'s, not this screen's**: Pending
 * Review, Pick List reviewed, and then Attended/Delivered or No Show/Not in.
 * They are what a team lead is told to look for, so they are quoted rather than
 * paraphrased.
 *
 * `state` exists so the badge can be styled without matching on display text —
 * colour is never the only signal here, but a rule keyed on an English sentence
 * breaks the day a delivery reads `Delivered` instead of `Attended`.
 *
 * A cancelled parcel is not a client and never reaches this: the list filters
 * it out first. See `isCurrentParcel`.
 */
export type ParcelState = 'pending' | 'reviewed' | 'attended' | 'no_show';

export function parcelStatus(parcel: Parcel): {
  readonly state: ParcelState;
  readonly label: string;
} {
  if (parcel.attendance === 'attended') return { state: 'attended', label: attendedLabel(parcel) };
  if (parcel.attendance === 'no_show') return { state: 'no_show', label: missedLabel(parcel) };
  if (parcel.reviewedAt === null) return { state: 'pending', label: 'Pending Review' };
  return { state: 'reviewed', label: 'Pick List reviewed' };
}
