import { formatSessionDate } from '../../lib/london-time';
import { describeSessionChoice, type DeliveryStanding } from '../../lib/session-description';
import type { ClosedLookup } from './referral-key-fields';
import type { OptionSources } from './referral-form-definition';

/**
 * The two runtime lists the form draws on, and the one place that turns an
 * entry in either into words.
 *
 * **A referrer must never be shown an id.** They choose a session and a reason
 * from dropdowns of readable options, and the confirmation afterwards is the
 * only chance anybody has to notice that the wrong session was picked before it
 * becomes a phone call — so it has to show the same words the dropdown did, not
 * the UUID that was submitted. Both screens resolving through here is what
 * stops the two drifting apart.
 *
 * Structural types rather than the generated `PublicSession` and
 * `ReferralReason`, so this stays a pure module with no reach into the API
 * client. The generated types satisfy them.
 *
 * No React, no fetching, tested directly.
 */

export interface SessionOption {
  readonly id: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly deliveryAvailability: 'not_offered' | 'full' | 'available';
}

/**
 * What a referrer's `PublicSession` can say about deliveries.
 *
 * **The one place all three states are distinguishable.** `deliveryAvailability`
 * is the only field in the API that separates "nobody is driving" from "the
 * delivery places have gone", and it is deliberately words rather than a count:
 * the unauthenticated list never carries a raw capacity or booked figure.
 */
export function standingFromAvailability(
  availability: SessionOption['deliveryAvailability'],
): DeliveryStanding {
  if (availability === 'not_offered') return 'none';
  if (availability === 'full') return 'full';
  return 'open';
}

export interface ReasonOption {
  readonly id: string;
  readonly label: string;
}

export interface ReferralLookups {
  readonly sessions: readonly SessionOption[];
  readonly referralReasons: readonly ReasonOption[];
}

/**
 * The date as a calendar day and the time as a wall clock, printed as the
 * charity typed them, and whether the session takes deliveries.
 *
 * **No end time on a public page**: a wrong closing time sends somebody to a
 * locked hall. That is why the formatted `when` is built here rather than
 * taken from `formatTimeRange` like every staff screen does.
 *
 * **No location**: one hall, so it said the same words on every option. See
 * `src/lib/session-description.ts`.
 */
export function describeSession(session: SessionOption): string {
  return describeSessionChoice(
    `${formatSessionDate(session.sessionDate)} at ${session.startTime}`,
    standingFromAvailability(session.deliveryAvailability),
  );
}

/**
 * The reason lookup as the form's options, which is what every screen reading
 * an answer back needs.
 *
 * The same rule as the form itself, applied to the other direction: a question
 * choosing from this list stores the reason's id, so a screen showing an answer
 * without the list shows a UUID. Both directions resolve through this file.
 */
export function reasonOptionSources(reasons: readonly ReasonOption[]): OptionSources {
  return {
    referralReasons: reasons.map((reason) => ({ value: reason.id, label: reason.label })),
  };
}

/**
 * What one lookup id reads as, or `null` when the list cannot answer.
 *
 * `null` is not an error to show. It means the list was unavailable or no
 * longer holds that entry, and the caller's fallback — showing what was
 * submitted — is better than showing nothing on the one screen a referrer gets.
 */
export function lookupLabel(
  lookups: ReferralLookups,
  source: ClosedLookup,
  id: string,
): string | null {
  if (source === 'sessions') {
    const session = lookups.sessions.find((candidate) => candidate.id === id);
    return session === undefined ? null : describeSession(session);
  }

  const reason = lookups.referralReasons.find((candidate) => candidate.id === id);
  return reason?.label ?? null;
}
