import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { publicReferralKeys } from './keys';
import { looksLikeEmail, sortByStart } from './public-referral.logic';

/**
 * The only import boundary for public referral data, and **the only client it
 * may use is `publicApi`.**
 *
 * That is structural, not tidiness. `api` carries the bearer token and the
 * single-flight 401 refresh; a referrer has no account and never will, so
 * routing one of these calls through it would attach a header that does not
 * exist and, on any 401, fire a `POST /auth/refresh` on behalf of somebody who
 * has no cookie to refresh. The public flow must cost zero auth round trips —
 * that is the promise `/refer` makes by being a sibling of the authenticated
 * layout rather than a child of it.
 *
 * Two endpoints today. The form, Turnstile and the fifteen-minute edit key are
 * Slice 6 and land here beside them.
 */

export type PublicSession = components['schemas']['PublicSession'];

/**
 * The verdict. Named from the generated `paths` rather than a component schema
 * because the server declares it inline — so it still cannot drift from the
 * contract, and a fixture that no longer matches fails to compile.
 *
 * `organisationName` is `string | null` **even when `authorised` is true**. The
 * spec says "present when authorised"; the type says it might not be. Believe
 * the type — a screen that assumes a name is there renders `null` into a
 * sentence, and this one is read by somebody deciding whether they can help.
 */
export type ReferrerCheck =
  paths['/api/v1/public/referrers/check']['post']['responses'][200]['content']['application/json'];

/**
 * Sessions with space in the next fourteen days. The window is the server's and
 * cannot be widened by a parameter, so there is nothing to key on.
 */
export function usePublicSessions() {
  return useQuery({
    queryKey: publicReferralKeys.sessions(),
    queryFn: async () => {
      const { sessions } = await unwrap(publicApi.GET('/api/v1/public/sessions'));
      return sortByStart(sessions);
    },
  });
}

/**
 * Is this address allowed to refer? Called with a **debounced** value — see
 * `use-debounced-value.ts` — because it runs as somebody types.
 *
 * Three deliberate options.
 *
 * **The address is in the body, never the URL.** `POST` is the server's choice
 * and it is the right one: a query string reaches browser history, the referrer
 * header of anything the page loads, and every access log between here and the
 * origin. This is somebody's identity at a charity.
 *
 * **`retry: false`, against the client's default of backing off a 429 twice.**
 * The person is already retrying — they are typing. A rate limit reached by a
 * keystroke-driven check is a limit that an automatic retry can only spend
 * further, and the answer a moment later is the same answer. The screen says to
 * wait; nothing here waits on their behalf.
 *
 * **A generous `staleTime`.** The verdict changes only when an admin edits the
 * authorised referrer list, so retyping an address just checked — the common
 * case, since a correction elsewhere in the field re-runs this — costs nothing.
 */
const CHECK_STALE_MS = 5 * 60_000;

export function useReferrerCheck(email: string) {
  return useQuery({
    queryKey: publicReferralKeys.referrerCheck(email),
    queryFn: () => unwrap(publicApi.POST('/api/v1/public/referrers/check', { body: { email } })),
    enabled: looksLikeEmail(email),
    retry: false,
    staleTime: CHECK_STALE_MS,
  });
}
