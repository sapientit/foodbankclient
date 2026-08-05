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

export function isPurged(referral: Pick<Referral, 'piiPurgedAt'>): boolean {
  return referral.piiPurgedAt !== null;
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
