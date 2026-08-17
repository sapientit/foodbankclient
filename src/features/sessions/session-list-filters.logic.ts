import { addCalendarDays, isCalendarDate } from '../../lib/london-time';
import type { SessionStatus } from './keys';

/**
 * What the two session lists are showing, and how it is read off the URL.
 *
 * Both `/run-sessions` and `/sessions` render the same table over the same
 * three controls — a date window and whether completed sessions are included —
 * so the rules for them live once, here, with no React and no fetching.
 *
 * **The status narrowing is done in this client, not by the server.**
 * `GET /sessions` takes a single `status` value, so "planned *or* in progress"
 * cannot be asked for at all. The date window is sent; the statuses are applied
 * to what comes back.
 */

/** A session still being run, or still waiting to be. */
export const OPEN_STATUSES: readonly SessionStatus[] = ['planned', 'in_progress'];

/**
 * How far back the list reaches by default.
 *
 * A fortnight, because outcomes are routinely recorded after the event — the
 * Saturday session gets its no-shows on the Monday — and because a completed
 * session is worth looking back at for about as long as anybody remembers
 * running it. Without a lower bound the server applies none at all, so ticking
 * `Show completed` would list every session the food bank has ever run.
 *
 * **This is a default, not a limit, and how far back a team lead should be able
 * to reach is an open question** — `../foodbankserver/OPEN-QUESTIONS.md` Q38.
 * The date box is a plain date box: typing 2024 into it lists 2024, and from
 * there the session's listener sheet — the one page that carries a reason for
 * referral — is a link away. Nothing about the permissions changed; what
 * changed is that there is now a screen that walks somebody there. If the
 * charity wants a limit it cannot be enforced from here anyway, so do not add
 * one until Q38 is answered.
 */
export const DAYS_BACK = 14;

/**
 * And how far forward. Six days for both roles, which is exactly a team lead's
 * horizon and deliberately narrower than an administrator's six weeks: this is
 * the list somebody opens to run a session this week, and an administrator who
 * wants further out types a later date. A `to` past the caller's horizon is
 * clamped by the server rather than refused, so widening it is always safe.
 */
export const DAYS_AHEAD = 6;

export interface SessionDateRange {
  readonly from: string;
  readonly to: string;
}

export function defaultSessionDateRange(today: string): SessionDateRange {
  return { from: addCalendarDays(today, -DAYS_BACK), to: addCalendarDays(today, DAYS_AHEAD) };
}

export interface SessionListSelection extends SessionDateRange {
  readonly showCompleted: boolean;
}

export const FROM_PARAM = 'from';
export const TO_PARAM = 'to';
export const SHOW_COMPLETED_PARAM = 'completed';

/**
 * The three controls, resolved from the query string.
 *
 * **A malformed or missing date falls back to the default rather than being
 * sent on.** The alternative is a hand-edited or stale link putting `to=last
 * week` in front of the server and a volunteer being told the request was bad;
 * a list a fortnight either side of today is always a defensible answer.
 */
export function readSessionListSelection(
  params: URLSearchParams,
  today: string,
): SessionListSelection {
  const defaults = defaultSessionDateRange(today);
  const from = params.get(FROM_PARAM);
  const to = params.get(TO_PARAM);

  return {
    from: from !== null && isCalendarDate(from) ? from : defaults.from,
    to: to !== null && isCalendarDate(to) ? to : defaults.to,
    showCompleted: params.get(SHOW_COMPLETED_PARAM) === 'true',
  };
}

/**
 * `Show completed` brings in **cancelled sessions as well as confirmed ones**,
 * and that is deliberate: it is now the only way to reach a cancelled session
 * from a list, and a cancelled session nobody can find is how somebody comes to
 * run a session that is not happening. The status column is what tells the two
 * apart.
 *
 * Structural rather than typed on the generated `Session`, so this is testable
 * without a sixteen-field fixture — the same reasoning as
 * `src/lib/session-description.ts`.
 */
export function filterSessionsByStatus<T extends { readonly status: SessionStatus }>(
  sessions: readonly T[],
  showCompleted: boolean,
): T[] {
  if (showCompleted) return [...sessions];
  return sessions.filter((session) => OPEN_STATUSES.includes(session.status));
}
