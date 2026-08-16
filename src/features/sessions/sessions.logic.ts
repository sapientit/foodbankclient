import type { RecurringSession, Session } from './queries';
import type { SessionStatus } from './keys';

/**
 * The pure half of sessions: status labels, the defensive sort, occupancy, the
 * grouping a planning list renders by, weekday labels for the weekly templates,
 * and the wall-clock validation the forms share.
 *
 * No React, no fetching, tested directly.
 */

/** `Record<SessionStatus, string>` over the generated union, so a new status fails to compile here first. */
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && Object.hasOwn(SESSION_STATUS_LABELS, value);
}

export interface StatusOption {
  readonly value: SessionStatus;
  readonly label: string;
}

export const SESSION_STATUS_OPTIONS: readonly StatusOption[] = Object.entries(
  SESSION_STATUS_LABELS,
).flatMap(([value, label]) => (isSessionStatus(value) ? [{ value, label }] : []));

/**
 * Soonest first, **ordered on `startsAtUtc` and never on the wall clock** — the
 * same reasoning as `sortByStart` in the referrals feature. The server already
 * promises this order ("Sessions, soonest first"); this is belt and braces, and
 * it is what stops a re-render ever showing a 10:00 session after a 09:30 one on
 * the day the clocks change.
 *
 * Anything that will not parse sorts last rather than corrupting the comparison
 * with a `NaN`.
 */
export function sortSessions(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => instant(a.startsAtUtc) - instant(b.startsAtUtc));
}

function instant(startsAtUtc: string): number {
  const parsed = Date.parse(startsAtUtc);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export interface Occupancy {
  readonly booked: number;
  readonly capacity: number;
  readonly isFull: boolean;
  readonly isOverCapacity: boolean;
}

/**
 * `booked` and `capacity` are households, directly comparable — and `booked` can
 * legitimately **exceed** `capacity`, because an admin may deliberately overfill
 * a session when moving someone. `isOverCapacity` exists so a screen can say so
 * plainly rather than rendering a number that looks like a bug.
 */
export function occupancy(session: Pick<Session, 'booked' | 'capacity'>): Occupancy {
  const { booked, capacity } = session;
  return { booked, capacity, isFull: booked >= capacity, isOverCapacity: booked > capacity };
}

export function describeOccupancy(o: Occupancy): string {
  return `${String(o.booked)} of ${String(o.capacity)} booked`;
}

export interface SessionGroup {
  readonly date: string;
  readonly sessions: readonly Session[];
}

/**
 * Groups an already-ordered list by `sessionDate` for a planning view with one
 * heading per day, **without reordering anything**. Consecutive runs only: the
 * list arrives soonest-first, so a date that recurs later (which should not
 * happen, but nothing here assumes the server is right) gets its own second
 * heading rather than being silently merged into the first — a merge would draw
 * a heading claiming a date's sessions are all together when they are not.
 */
export function groupByDate(sessions: readonly Session[]): SessionGroup[] {
  const groups: SessionGroup[] = [];

  for (const session of sessions) {
    const current = groups.at(-1);
    if (current?.date === session.sessionDate) {
      groups[groups.length - 1] = { date: current.date, sessions: [...current.sessions, session] };
    } else {
      groups.push({ date: session.sessionDate, sessions: [session] });
    }
  }

  return groups;
}

/** ISO-8601: 1 = Monday, 7 = Sunday — matches the server's `weekday` exactly. */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Object.hasOwn(WEEKDAY_LABELS, value);
}

export interface WeekdayOption {
  readonly value: number;
  readonly label: string;
}

export const WEEKDAY_OPTIONS: readonly WeekdayOption[] = Object.entries(WEEKDAY_LABELS).map(
  ([value, label]) => ({ value: Number(value), label }),
);

/**
 * Maintenance order for the weekly-template list: by weekday, then by start
 * time within a day. The endpoint makes no ordering promise (there is no
 * "soonest first" language on `GET /recurring-sessions`, unlike the
 * materialised list), so this is this client's own rule for a screen that is
 * read start-to-finish rather than walked like a shelf.
 */
export function sortRecurringSessions(rows: readonly RecurringSession[]): RecurringSession[] {
  return [...rows].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

/**
 * The server's `HH:MM` pattern, copied rather than re-derived: `^([01][0-9]|
 * 2[0-3]):[0-5][0-9]$`. Kept here so both the ad hoc and the weekly-template
 * forms validate the same way a session ever will be accepted.
 */
export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}

export type WholeNumberProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'above-maximum';

export type WholeNumber =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: WholeNumberProblem };

/**
 * An unsigned whole number within `[minimum, maximum]`, held and parsed as text
 * — the same reasoning as `parseWholeQuantity` in the stock feature: an
 * `<input type="number">` reports an empty box and a lone minus sign
 * identically, and the difference between them is a sentence a person can act
 * on. Shared by `durationMinutes` (1–1440) and `capacity` (0–1000), which is
 * why the bounds are parameters rather than baked in.
 */
export function parseWholeNumber(
  text: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): WholeNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };
  if (value < bounds.minimum) return { ok: false, problem: 'below-minimum' };
  if (value > bounds.maximum) return { ok: false, problem: 'above-maximum' };

  return { ok: true, value };
}

/** `durationMinutes`: `minimum: 1, maximum: 1440` on both session endpoints. */
export const DURATION_BOUNDS = { minimum: 1, maximum: 1440 };

/** `capacity`: `minimum: 0, maximum: 1000`. Zero is valid — a session can be closed to new referrals without being deleted. */
export const CAPACITY_BOUNDS = { minimum: 0, maximum: 1000 };

export const DEFAULT_CAPACITY = 25;

/** `location`: `maxLength: 200` on every session endpoint. */
export const MAX_LOCATION_LENGTH = 200;

/** `RecurringSession.name`: `maxLength: 120`. */
export const MAX_RECURRING_NAME_LENGTH = 120;

export type DeliveryWindowProblem = 'start-required' | 'end-required' | 'end-not-after-start';

/**
 * The client's own rule for the two delivery-window boxes on the four
 * maintenance forms — settled 2026-08-16 — which is stricter than the
 * server's `400`s (`API.md` "A session's delivery window") because the form
 * no longer lets "both blank while deliveries are on" happen at all: **while
 * `deliveriesAllowed` is off the two times are irrelevant** and this reports
 * no problem however the boxes read, because the form clears and disables
 * them; **while it is on, both are required**, and an end at or before the
 * start is still invalid. A *stored* both-null window with deliveries on is
 * still a real, valid state the server can return — see
 * `describeDeliveryWindow` — it just cannot be produced from this form any
 * more.
 *
 * `HH:MM` compares correctly as a plain string because it is always
 * zero-padded to two digits either side of the colon — the same reasoning
 * `sortRecurringSessions` already relies on for `startTime`.
 */
export function validateDeliveryWindow(
  deliveriesAllowed: boolean,
  start: string,
  end: string,
): DeliveryWindowProblem | null {
  if (!deliveriesAllowed) return null;
  if (start === '') return 'start-required';
  if (end === '') return 'end-required';
  if (end <= start) return 'end-not-after-start';
  return null;
}

/**
 * How a *stored* delivery window pair reads on a maintenance screen. Both
 * null is a real, common state — not a gap in the data — so it earns its own
 * sentence rather than an empty dash that would read as missing information.
 * Structural rather than typed on `Session` so it also takes a
 * `RecurringSession` row without a second overload.
 */
export function describeDeliveryWindow(window: {
  readonly deliveryWindowStart: string | null;
  readonly deliveryWindowEnd: string | null;
}): string {
  const { deliveryWindowStart, deliveryWindowEnd } = window;
  if (deliveryWindowStart === null || deliveryWindowEnd === null) {
    return 'Deliveries go out across the session’s own hours.';
  }
  return `${deliveryWindowStart}–${deliveryWindowEnd}`;
}

/**
 * `deliveriesAllowed: false` means the session has nobody to drive — that
 * takes precedence over the window, which is otherwise meaningless. See
 * `API.md` "Deliveries can be switched off per session".
 */
export function describeDeliveries(session: {
  readonly deliveriesAllowed: boolean;
  readonly deliveryWindowStart: string | null;
  readonly deliveryWindowEnd: string | null;
}): string {
  if (!session.deliveriesAllowed) return 'This session does not take deliveries.';
  return describeDeliveryWindow(session);
}

/** A cancellation `reason`: `maxLength: 500`. */
export const MAX_CANCEL_REASON_LENGTH = 500;

/**
 * Predicts the one refusal that is safe to predict: **a confirmed session
 * cannot be amended or cancelled.** Unlike the users lockout guards, this
 * depends on nothing but the row already on screen — nobody else's action can
 * turn a `planned` session back into `confirmed`, only forward — so it is
 * stated flatly rather than hedged. Anything this does not catch (the session
 * was confirmed a second after the page loaded) is still submitted and the
 * `409` shown verbatim; this only saves the round trip for the case that was
 * already certain.
 */
export function describeLockedSession(session: Pick<Session, 'status'>): string | null {
  if (session.status !== 'confirmed') return null;
  return 'This session has been confirmed and closed, so it can no longer be changed here.';
}

/**
 * What the materialisation job did, in a sentence.
 *
 * **`sessionsCreated` is optional in the generated types and is not asserted
 * away.** `openapi.yaml` gives the job report no `required:` array, so every
 * field on it is optional to the compiler. Defaulting a missing count to `0`
 * would print "no new sessions" — a specific, confident claim — on a response
 * that did not actually say so, which is exactly the wrong way round for a
 * screen whose entire job is telling an admin whether anything happened. A
 * missing count reports success without a number instead.
 *
 * Zero is a real and common answer, not a failure: the job is idempotent, so
 * running it twice legitimately creates nothing the second time.
 */
export function describeMaterialisation(report: { sessionsCreated?: number }): string {
  const created = report.sessionsCreated;
  if (created === undefined) return 'Sessions generated from the weekly templates.';
  if (created === 0) {
    return 'No new sessions — every session up to six weeks ahead already existed.';
  }
  if (created === 1) return 'Created 1 session from the weekly templates.';
  return `Created ${String(created)} sessions from the weekly templates.`;
}
