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
