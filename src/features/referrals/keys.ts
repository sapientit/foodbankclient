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
  reasons: () => [...publicReferralKeys.all, 'reasons'] as const,
  organisations: () => [...publicReferralKeys.all, 'organisations'] as const,
  referrerCheck: (email: string) => [...publicReferralKeys.all, 'referrer-check', email] as const,
};

/**
 * The staff-facing side: `GET /referrals`, one at a time, amend, move and
 * cancel. A deliberately separate root from `publicReferralKeys` above —
 * they are two different clients (`api` versus `publicApi`, see `queries.ts`)
 * against two different parts of the contract, and nothing here is ever
 * invalidated by a public mutation or vice versa.
 */
export type ReferralStatus = 'pending_review' | 'active' | 'reviewed' | 'rejected' | 'cancelled';

/**
 * `GET /referrals` takes `sessionId` and `status` as its only filters — no
 * free-text search, because nothing in `Referral` is safe to search by
 * without also deciding whether that counts as "seeing why someone was
 * referred" (`API.md` §2's admin-only line). Filtering on ids and a status
 * enum sidesteps the question entirely.
 */
export interface ReferralListFilters {
  readonly sessionId?: string;
  readonly status?: ReferralStatus;
}

export const referralKeys = {
  all: ['referrals'] as const,
  lists: () => [...referralKeys.all, 'list'] as const,
  list: (filters: ReferralListFilters) => [...referralKeys.lists(), filters] as const,
  detail: (id: string) => [...referralKeys.all, 'detail', id] as const,
  repeatReferrals: (id: string, excludePostcode: boolean) =>
    [...referralKeys.all, 'repeat-referrals', id, { excludePostcode }] as const,
  /**
   * Every search that has been run, as one prefix. A mutation cannot know which
   * criteria happen to be cached — the key is the criteria themselves — so it
   * invalidates the lot. `lists()` does not cover these: `['referrals','list']`
   * and `['referrals','search']` are disjoint, which is how an amended referral
   * used to leave yesterday's name and status on the results an administrator
   * came back to.
   */
  searches: () => [...referralKeys.all, 'search'] as const,
  search: (input: unknown) => [...referralKeys.searches(), input] as const,
  /**
   * Which search was last run — the criteria themselves, so that opening a
   * result and coming back shows the same list. Personal data, and in the cache
   * for the same reason `referrerCheck` above is: in memory, never persisted,
   * and gone with the `queryClient.clear()` every sign-out already does.
   */
  lastSearch: () => [...referralKeys.all, 'last-search'] as const,
};
