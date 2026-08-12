import { formatSessionDate } from '../../lib/london-time';
import type { ClosedLookup } from './referral-key-fields';

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
  readonly location: string;
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
 * charity typed them, then where to go.
 *
 * **No end time on a public page**: a wrong closing time sends somebody to a
 * locked hall.
 */
export function describeSession(session: SessionOption): string {
  return `${formatSessionDate(session.sessionDate)} at ${session.startTime} — ${session.location}`;
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
