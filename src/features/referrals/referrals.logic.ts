import type { ReferralStatus } from './keys';
import type { Referral } from './queries';

/**
 * The pure half of staff referral maintenance: status labels, the defensive
 * sort, the household-size sentence, the admin-field presence check that
 * drives what a screen renders, the over-capacity warning `screenDetails.md`
 * requires for a move, and the whole-number parsing the amend form shares
 * with every other numeric form in this app.
 *
 * No React, no fetching, tested directly.
 */

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending_review: 'Awaiting review',
  active: 'Active',
  reviewed: 'Reviewed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function isReferralStatus(value: unknown): value is ReferralStatus {
  return typeof value === 'string' && Object.hasOwn(REFERRAL_STATUS_LABELS, value);
}

export interface ReferralStatusOption {
  readonly value: ReferralStatus;
  readonly label: string;
}

export const REFERRAL_STATUS_OPTIONS: readonly ReferralStatusOption[] = Object.entries(
  REFERRAL_STATUS_LABELS,
).flatMap(([value, label]) => (isReferralStatus(value) ? [{ value, label }] : []));

/**
 * Most recently referred first. The endpoint makes no ordering promise, so
 * this is this client's own rule — the same reasoning as `sortRecurringSessions`
 * in the sessions feature. Anything that will not parse sorts last rather than
 * corrupting the comparison with a `NaN`.
 */
export function sortReferrals(referrals: readonly Referral[]): Referral[] {
  return [...referrals].sort((a, b) => instant(b.referredAt) - instant(a.referredAt));
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function describeHousehold(referral: Pick<Referral, 'adults' | 'children'>): string {
  const adultWord = referral.adults === 1 ? 'adult' : 'adults';
  const childWord = referral.children === 1 ? 'child' : 'children';
  return `${String(referral.adults)} ${adultWord}, ${String(referral.children)} ${childWord}`;
}

/**
 * Whether this referral was opened from the search results, read from the
 * router's location state.
 *
 * That state is `unknown` and comes from the browser's history, so it can be
 * anything at all — a restored session, a hand-edited entry, a link somebody
 * saved. Everything but the exact flag reads as "no", which is why this is a
 * function rather than a cast at the call site. The flag is deliberately a bare
 * boolean: the search itself is a date of birth, a postcode and a phone number,
 * and history state is not a place any of those may go.
 */
export function cameFromSearch(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fromSearch' in state &&
    state.fromSearch === true
  );
}

/**
 * Whether this screen was arrived at by copying the referral that was open a
 * moment ago, read from the router's location state — the same shape and the
 * same reasoning as `cameFromSearch` above, including that the flag is a bare
 * boolean. The copy swaps one household's record for another under the
 * administrator without a page they chose to open, so the screen has to say so;
 * what it must not do is carry any part of either household in history state.
 */
export function cameFromCopy(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'fromCopy' in state && state.fromCopy === true
  );
}

/**
 * The referee's name for a heading or a table cell. Both halves are nullable —
 * a purged referral has neither — so this returns `null` rather than letting
 * the string `null` or a stray space reach a screen, and a caller decides what
 * to show instead.
 *
 * Kept as one function rather than joined at each call site because there are
 * four of them and a purged referral is exactly the case each would forget.
 */
export function refereeName(
  referral: Pick<Referral, 'refereeFirstName' | 'refereeSurname'>,
): string | null {
  const parts = [referral.refereeFirstName, referral.refereeSurname].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * Surname first, for a list somebody scans. `screenDetails.md` has the surname
 * held apart precisely because it is "what a list sorts by and what a volunteer
 * matches a bag to".
 */
export function refereeNameForList(
  referral: Pick<Referral, 'refereeFirstName' | 'refereeSurname'>,
): string | null {
  const { refereeFirstName: first, refereeSurname: surname } = referral;
  if (surname === null || surname.trim() === '') return refereeName(referral);
  return first === null || first.trim() === '' ? surname : `${surname}, ${first}`;
}

/** Awaiting an administrator's decision, and therefore not a booking. */
export function isAwaitingReview(referral: Pick<Referral, 'status'>): boolean {
  return referral.status === 'pending_review';
}

/**
 * Referrals awaiting review sort ahead of everything else, each group newest
 * first. A household waiting on a decision is more urgent than one already
 * booked in — `screenDetails.md`, "Referrals awaiting review" — and putting
 * them at the top is the difference between a queue somebody works and a queue
 * somebody has to go looking for.
 */
export function sortForReview(referrals: readonly Referral[]): Referral[] {
  const sorted = sortReferrals(referrals);
  return [
    ...sorted.filter((referral) => isAwaitingReview(referral)),
    ...sorted.filter((referral) => !isAwaitingReview(referral)),
  ];
}

/**
 * The single fact this whole slice turns on. `reasonId`, `referrerEmail` and
 * `referrerPhone` are absent together or present together — they come off the
 * same role check in the server's response mapper (`API.md` §2), never
 * independently — so testing for one key's presence is testing for the whole
 * admin-only bundle. Checking the **key**, not a role read from `useAuth`
 * elsewhere, is what keeps a screen correct even if the two ever disagreed:
 * the object actually returned is the only thing that matters for what is
 * safe to render.
 */
export function hasAdminFields(referral: Referral): referral is Referral & {
  reasonId: string;
  referrerEmail: string | null;
  referrerPhone: string | null;
  reviewComment: string | null;
} {
  return Object.hasOwn(referral, 'reasonId');
}

/** The previous-referral summary is withheld with the rest of the admin review data. */
export function hasRepeatReferralSummary(
  referral: Referral,
): referral is Referral & { repeatReferrals: NonNullable<Referral['repeatReferrals']> } {
  return Object.hasOwn(referral, 'repeatReferrals');
}

export function isPurged(referral: Pick<Referral, 'piiPurgedAt'>): boolean {
  return referral.piiPurgedAt !== null;
}

export type ReferralOutcome = NonNullable<Referral['outcome']>;

/**
 * What became of the household, as against `status`, which is what became of
 * the referral. `API.md`: "The two answer different questions and must never be
 * read as one" — so these are the outcome's own words and share nothing with
 * `REFERRAL_STATUS_LABELS`. The pairs are the session client list's, because a
 * team lead reading "No Show/Not in" there and an administrator reading it here
 * are looking at the same fact.
 */
export const REFERRAL_OUTCOME_LABELS: Record<ReferralOutcome, string> = {
  attended: 'Attended/Delivered',
  no_show: 'No Show/Not in',
  booked: 'Still booked',
};

/**
 * `outcome` is **absent from `GET /referrals` list rows** — deriving it there
 * would cost the server a second query over the whole session — so it is
 * optional on the generated type and gated on reading the object, the same
 * convention `hasAdminFields` follows. Absent is not `booked`.
 */
export function hasOutcome(
  referral: Pick<Referral, 'outcome'>,
): referral is Pick<Referral, 'outcome'> & { outcome: ReferralOutcome } {
  return Object.hasOwn(referral, 'outcome');
}

/**
 * The outcome worth putting on screen, or `null` where it would say nothing the
 * status has not already said.
 *
 * A cancelled or rejected referral reads `outcome: "booked"` — nothing happened
 * on the day, and the server is explicit that this is where a cancellation is
 * recorded rather than a contradiction. It is still the wrong thing to show:
 * "Cancelled" beside "Still booked" reads as a household who is coming after
 * all. `screenDetails.md`, the referral detail screen: what became of the
 * household is shown "only where it says something the status does not".
 */
export function displayedOutcome(
  referral: Pick<Referral, 'status' | 'outcome'>,
): ReferralOutcome | null {
  if (referral.status === 'cancelled' || referral.status === 'rejected') return null;
  return hasOutcome(referral) ? referral.outcome : null;
}

/**
 * Whether this referral can be copied onto another session — the same test the
 * server gates `POST /referrals/{id}/copy` on, so that the screen and the server
 * agree rather than the administrator finding out by pressing the button.
 *
 * **Only where the original can no longer come to anything**: it was cancelled
 * or rejected, or the household did not turn up. A referral still on its way to
 * being fed is *moved*, and `screenDetails.md` is explicit that the two are
 * never offered as alternatives for the same referral. A household who has
 * already collected is not copied either — feeding them again is an ordinary
 * new referral.
 *
 * A purged referral has nothing left to copy and is a `409`; that is the caller's
 * own guard, since every other action on this screen is hidden for the same
 * reason and the whole panel goes with it.
 */
export function canCopyReferral(referral: Pick<Referral, 'status' | 'outcome'>): boolean {
  if (referral.status === 'cancelled' || referral.status === 'rejected') return true;
  return hasOutcome(referral) && referral.outcome === 'no_show';
}

/**
 * The copy lands on a session the administrator chooses, and a full one is
 * warned about rather than refused — `acknowledgeOverCapacity` works "exactly
 * as a move does" (`API.md`). Same arithmetic as `moveCapacityWarning`,
 * different sentence, because "moving this referral here" is not what is about
 * to happen and the administrator is being asked to confirm the other thing.
 */
export function copyCapacityWarning(target: TargetSessionOccupancy): string | null {
  if (!wouldExceedCapacity(target)) return null;

  return `This session already has ${String(target.booked)} of ${String(target.capacity)} places booked. Copying this referral here will take it over capacity.`;
}

/**
 * Predicts the one refusal that is safe to predict, the same shape as
 * `describeLockedSession`: **a cancelled referral cannot be amended, moved or
 * cancelled again.** The lifecycle in the server's `CLAUDE.md`
 * (`created → scheduled(session) → moved(session) | cancelled`) has no arrow
 * back out of `cancelled`, and nobody else's action can undo that — so this is
 * stated flatly. Anything this does not catch (cancelled a second after the
 * page loaded) is still submitted and the `409` or `404` shown verbatim; this
 * only saves the round trip for the case that was already certain.
 */
export function describeLockedReferral(referral: Pick<Referral, 'status'>): string | null {
  if (referral.status === 'cancelled') {
    return 'This referral has been cancelled, so it can no longer be amended or moved from here.';
  }
  if (referral.status === 'rejected') {
    return 'This referral was rejected, so it can no longer be amended or moved from here.';
  }
  return null;
}

/**
 * The second refusal that is safe to predict, and a newer one than
 * `describeLockedReferral`: **once a household has an attendance outcome, their
 * referral can no longer be cancelled or moved.** Both are a `409` — "the same
 * stopping point as a move, settled by the charity on 2026-08-15"
 * (`openapi.yaml`, the cancel route). The day has happened and its record is not
 * rewritten afterwards.
 *
 * Deliberately **not** folded into `describeLockedReferral`, which also governs
 * amending: a name spelt wrong on a referral whose household has already
 * collected is still worth correcting, and only cancelling and moving are
 * refused. Two different refusals with two different scopes.
 *
 * The no-show sentence names copying, because that is the whole answer to the
 * phone call that produces it — `screenDetails.md`, "#Copying a referral": the
 * two "must not be offered as alternatives for the same referral".
 */
export function describeSettledReferral(referral: Pick<Referral, 'outcome'>): string | null {
  if (!hasOutcome(referral)) return null;

  if (referral.outcome === 'attended') {
    return 'This household has already collected or been delivered to, so this referral can no longer be cancelled or moved.';
  }
  if (referral.outcome === 'no_show') {
    return 'This household did not turn up, so this referral can no longer be cancelled or moved. Copy it to another session to give them another chance.';
  }
  return null;
}

export interface TargetSessionOccupancy {
  readonly booked: number;
  readonly capacity: number;
}

/**
 * `screenDetails.md`: an admin can move a referral "to another session (even
 * if that exceeds capacity with a client generated warning)". The server does
 * not refuse this — `PATCH /referrals/{id}` accepts `acknowledgeOverCapacity`
 * precisely so it does not have to — so the warning is entirely this client's
 * job. A session already at or over capacity is exactly the one where the
 * next referral moved in pushes it further over, so "already full" and "would
 * be pushed over capacity by one more" are the same test.
 */
export function wouldExceedCapacity(target: TargetSessionOccupancy): boolean {
  return target.booked >= target.capacity;
}

/** `null` when the move is unremarkable — the common case, and the reason this is a function rather than always-rendered text. */
export function moveCapacityWarning(target: TargetSessionOccupancy): string | null {
  if (!wouldExceedCapacity(target)) return null;

  return `This session already has ${String(target.booked)} of ${String(target.capacity)} places booked. Moving this referral here will take it over capacity.`;
}

export type WholeNumberProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'above-maximum';

export type WholeNumberResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: WholeNumberProblem };

/**
 * An unsigned whole number within `[minimum, maximum]`, held and parsed as
 * text — the same reasoning as `parseWholeNumber` in sessions and
 * model-parcels. Not imported from either sibling feature — only a feature's
 * `queries.ts` may be shared, so this is the referrals copy.
 */
export function parseWholeNumber(
  text: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): WholeNumberResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };
  if (value < bounds.minimum) return { ok: false, problem: 'below-minimum' };
  if (value > bounds.maximum) return { ok: false, problem: 'above-maximum' };

  return { ok: true, value };
}

/** `ReferralSubmission.adults`: `minimum: 1, maximum: 30`. `ReferralSelfAmend` repeats only the minimum; the maximum is carried over for a sane upper bound on the same field. */
export const ADULTS_BOUNDS = { minimum: 1, maximum: 30 };

/** `ReferralSubmission.children`: `minimum: 0, maximum: 30`. */
export const CHILDREN_BOUNDS = { minimum: 0, maximum: 30 };

/** `ReferralSubmission.refereeFirstName` / `refereeSurname`: `maxLength: 100` each. */
export const MAX_NAME_PART_LENGTH = 100;

/** `ReferralSubmission.referrerName`: `maxLength: 200`. */
export const MAX_REFERRER_NAME_LENGTH = 200;

/** `ReferralSubmission.refereeAddress`: `maxLength: 500`. */
export const MAX_REFEREE_ADDRESS_LENGTH = 500;

/** `ReferralSubmission.refereePostcode`: `minLength: 2, maxLength: 12`. */
export const REFEREE_POSTCODE_BOUNDS = { minLength: 2, maxLength: 12 };

/** `ReferralSubmission.referrerPhone` / `refereePhone`: `minLength: 5, maxLength: 30`, shared by both phone fields. */
export const PHONE_BOUNDS = { minLength: 5, maxLength: 30 };

/** A cancellation `reason`: `maxLength: 500`, the same bound as a session's. */
export const MAX_CANCEL_REASON_LENGTH = 500;

/**
 * Turns a blank phone field into `null` rather than an empty string the
 * server would store forever. `refereePhone` and `referrerPhone` are both
 * `[string, 'null']` on `ReferralSelfAmend` — nullable is how "no phone
 * number" is expressed, not `''`.
 */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** `ReferralReview.comment`: `maxLength: 200`. One line, not a note field. */
export const MAX_REVIEW_COMMENT_LENGTH = 200;
