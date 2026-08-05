import type { PublicSession } from './queries';

/**
 * The pure half of the public probe: what counts as an address worth asking the
 * server about, and the order sessions go on the screen.
 *
 * No React, no fetching, tested directly. Both functions exist because of a
 * constraint rather than a preference — one guards a rate limit, the other
 * guards a clock — and the reasoning is in each.
 */

/**
 * Roughly `someone@somewhere.tld`, and roughly is the point.
 *
 * This is **not** validation: the server decides whether an address may refer,
 * and a client that second-guesses the shape of an email address is wrong more
 * often than it is helpful. It is a rate-limit gate. The check runs as the
 * referrer types, the public endpoints allow around sixty calls per IP per
 * minute, and every keystroke before the `@` is a request that can only be
 * answered "no". So nothing is asked until there is something to ask about.
 *
 * Being generous costs nothing here — a false positive is one request that
 * returns `authorised: false`, which is exactly what the screen would show
 * anyway.
 */
/**
 * How long the referrer check waits after the last keystroke.
 *
 * Four hundred milliseconds is long enough to cover the gap between two
 * characters typed by somebody who is not a fast typist, and short enough that
 * the answer arrives while they are still looking at the field. The generic hook
 * is `src/lib/use-debounced-value.ts`; the number lives here because what it is
 * defending is this endpoint's per-IP rate limit.
 */
export const CHECK_DEBOUNCE_MS = 400;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

/**
 * Trimmed and lowercased, the way the server stores authorised addresses.
 *
 * Also the cache key, so `Ada@Charity.org` and `ada@charity.org` are one entry
 * and one request rather than two of each. A trailing space pasted in from an
 * email client is the common case.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** What the server said about the address as it currently stands. */
export interface ReferrerCheckResult {
  readonly authorised: boolean;
  readonly organisationName: string | null;
}

/** What the screen says beside the address, if anything. */
export type ReferrerVerdict =
  | { readonly kind: 'silent' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'authorised'; readonly organisationName: string | null }
  | { readonly kind: 'unrecognised' };

/**
 * What to say about the address, and **when it is fair to say it**.
 *
 * `looksLikeEmail` is deliberately generous, which means a half-typed address
 * is checked: `pete@guildford.gov` is a complete-looking address on the way to
 * `pete@guildford.gov.uk`, and the server answers the question it was asked.
 * Announcing that answer told a recognised referrer their own address was not
 * recognised, in a live region, while they were still typing it.
 *
 * So the two verdicts are not shown on the same terms, and `screenDetails.md`
 * ("The referrer's email address is checked as they type it") now says so:
 *
 * - **Recognising somebody is said as soon as it is known.** It is reassurance,
 *   it is what fills the organisation in for them, and being early is the point.
 * - **Not recognising somebody waits until they have left the field** — still
 *   long before they have typed a household's details, which is what checking
 *   early is for, but no longer a verdict on an address nobody has finished.
 */
export function referrerVerdict(state: {
  readonly checking: boolean;
  readonly result: ReferrerCheckResult | undefined;
  readonly left: boolean;
}): ReferrerVerdict {
  if (state.checking) return { kind: 'checking' };
  if (state.result === undefined) return { kind: 'silent' };
  if (state.result.authorised) {
    return { kind: 'authorised', organisationName: state.result.organisationName };
  }
  return state.left ? { kind: 'unrecognised' } : { kind: 'silent' };
}

/**
 * The organisation a recognised address already belongs to, for the form to
 * fill in rather than ask for — `screenDetails.md`: "the organisation it
 * belongs to is already known and the form fills that in for them".
 *
 * **Only one of the offered organisations.** The dropdown is the charity's own
 * list and the server derives both it and this name from the same authorised
 * referrers, so a name that is somehow not on the list would select nothing
 * while the answer said otherwise. Asking is better than a box that disagrees
 * with itself.
 */
export function suggestedOrganisation(
  result: ReferrerCheckResult | undefined,
  offered: readonly string[],
): string | null {
  if (result?.authorised !== true) return null;
  const { organisationName } = result;
  if (organisationName === null || !offered.includes(organisationName)) return null;
  return organisationName;
}

/**
 * Soonest first, **ordered on `startsAtUtc` and never on the wall clock**.
 *
 * The server already returns them in this order, so this is belt and braces —
 * but it is the cheap half of the charter's rule, and the expensive half is what
 * it protects: `sessionDate` plus `startTime` is a wall-clock day and a wall
 * -clock time, and sorting on those puts a 10:00 session before a 09:30 one on
 * the day the clocks go back. `startsAtUtc` is the instant, and the instant is
 * the only thing that orders correctly.
 *
 * Anything that will not parse sorts last rather than corrupting the comparison
 * with a `NaN`, which would leave the whole list in an arbitrary order.
 */
export function sortByStart(sessions: readonly PublicSession[]): PublicSession[] {
  return [...sessions].sort((a, b) => instant(a.startsAtUtc) - instant(b.startsAtUtc));
}

function instant(startsAtUtc: string): number {
  const parsed = Date.parse(startsAtUtc);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}
