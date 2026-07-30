/**
 * The query keys the public referral flow owns. Structured, exported, and never
 * written inline at a call site.
 *
 * **`referrerCheck` carries an email address, and that is the one place it is
 * allowed to be.** A query key lives in the in-memory cache and nowhere else: it
 * is not a URL, it is never persisted, and the query client is cleared on sign
 * out. The address travels to the server in the POST body — see `queries.ts`.
 * Keying on it is what makes a stale answer structurally unable to overwrite a
 * newer one, because two addresses are two cache entries rather than one racing
 * variable.
 */
export const publicReferralKeys = {
  all: ['public-referrals'] as const,
  sessions: () => [...publicReferralKeys.all, 'sessions'] as const,
  referrerCheck: (email: string) => [...publicReferralKeys.all, 'referrer-check', email] as const,
};
