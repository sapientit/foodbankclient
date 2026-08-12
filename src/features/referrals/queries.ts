import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, publicApi } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { sessionKeys } from '../sessions/keys';
import { publicReferralKeys, referralKeys, type ReferralListFilters } from './keys';
import { looksLikeEmail, sortByStart } from './public-referral.logic';
import { sortReferrals } from './referrals.logic';

/**
 * The only import boundary for referral data — both halves of it. This file
 * holds two unrelated clients side by side and neither may cross into the
 * other's territory:
 *
 * **The public flow, first, and the only client it may use is `publicApi`.**
 * That is structural, not tidiness. `api` carries the bearer token and the
 * single-flight 401 refresh; a referrer has no account and never will, so
 * routing one of these calls through it would attach a header that does not
 * exist and, on any 401, fire a `POST /auth/refresh` on behalf of somebody who
 * has no cookie to refresh. The public flow must cost zero auth round trips —
 * that is the promise `/refer` makes by being a sibling of the authenticated
 * layout rather than a child of it. Turnstile is the one piece of it still
 * outstanding; there is no edit key and there is not going to be one.
 *
 * **Referral maintenance, below, always uses `api`.** It is authenticated
 * staff work — reading, amending, moving and cancelling a referral someone
 * already submitted — and its own comment block marks where it starts.
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
 * `CHECK_DEBOUNCE_MS` in `public-referral.logic.ts` — because it runs as
 * somebody types.
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

/**
 * The two maintained lookups the form draws on, both public and both changing
 * only when an administrator edits them — so the same generous `staleTime` as
 * the referrer check. A referrer working through seven pages must not spend a
 * request per page on lists that cannot have moved.
 */
const LOOKUP_STALE_MS = 5 * 60_000;

export type ReferralReason = components['schemas']['ReferralReason'];

export function usePublicReferralReasons() {
  return useQuery({
    queryKey: publicReferralKeys.reasons(),
    queryFn: async () => {
      const { referralReasons } = await unwrap(publicApi.GET('/api/v1/public/referral-reasons'));
      return referralReasons;
    },
    staleTime: LOOKUP_STALE_MS,
  });
}

/**
 * The organisation dropdown on page one. Names only — the server never sends
 * the match rules behind them, and this form has no business knowing which
 * addresses are authorised, only which organisations exist.
 */
export function usePublicOrganisations() {
  return useQuery({
    queryKey: publicReferralKeys.organisations(),
    queryFn: async () => {
      const { organisations } = await unwrap(publicApi.GET('/api/v1/public/organisations'));
      return organisations.map((organisation) => organisation.name);
    },
    staleTime: LOOKUP_STALE_MS,
  });
}

export type ReferralSubmission = components['schemas']['ReferralSubmission'];
export type ReferralReceipt = components['schemas']['ReferralReceipt'];

/**
 * The split answer map, assembled into the request body.
 *
 * **Field by field, with no cast.** `splitSubmission` cannot know which columns
 * the config happens to ask for — it reads a JSON file — so its output is a
 * loose map, and the gap between that and `ReferralSubmission` is exactly the
 * kind of place `as` would paper over a form that had quietly lost a required
 * question. `.claude/rules/api-contract.md`: hand-written request types are a
 * bug and unchecked casts are worse, so this reads the generated type's fields
 * one at a time and says so when one is missing.
 *
 * Returns the missing field names rather than throwing: a misconfigured form is
 * a bug in a released config, and the screen can say which question is absent
 * instead of showing a stack trace to a referrer.
 */
export type SubmissionBuild =
  | { readonly ok: true; readonly body: ReferralSubmission }
  | { readonly ok: false; readonly missing: readonly string[] };

export function buildSubmissionBody(
  keyFields: Readonly<Record<string, string | number | boolean | null>>,
  answers: Readonly<Record<string, unknown>>,
): SubmissionBuild {
  const missing: string[] = [];

  const text = (name: string): string => {
    const value = keyFields[name];
    if (typeof value === 'string' && value !== '') return value;
    missing.push(name);
    return '';
  };

  const count = (name: string): number => {
    const value = keyFields[name];
    if (typeof value === 'number') return value;
    missing.push(name);
    return 0;
  };

  const flag = (name: string): boolean => keyFields[name] === true;

  // Returns a whole property or nothing at all, rather than a value that might
  // be `undefined` — `exactOptionalPropertyTypes` draws that distinction, and
  // it is the right one here: the contract has no "referrerPhone: undefined".
  const optional = (name: string): Readonly<Record<string, string>> => {
    const value = keyFields[name];
    return typeof value === 'string' && value !== '' ? { [name]: value } : {};
  };

  const body: ReferralSubmission = {
    sessionId: text('sessionId'),
    reasonId: text('reasonId'),
    referrerName: text('referrerName'),
    referrerEmail: text('referrerEmail'),
    referrerOrganisation: text('referrerOrganisation'),
    refereeFirstName: text('refereeFirstName'),
    refereeSurname: text('refereeSurname'),
    refereeDateOfBirth: text('refereeDateOfBirth'),
    refereeAddress: text('refereeAddress'),
    refereePostcode: text('refereePostcode'),
    adults: count('adults'),
    children: count('children'),
    isDelivery: flag('isDelivery'),
    needsFuelHelp: flag('needsFuelHelp'),
    answers,
    // Optional on the contract, and omitted rather than sent empty — a blank
    // phone number stored forever is a different thing from one nobody gave.
    ...optional('referrerPhone'),
    ...optional('refereePhone'),
  };

  return missing.length === 0 ? { ok: true, body } : { ok: false, missing };
}

/**
 * The only open write in the system.
 *
 * **`retry: false`, and that is a safety property rather than a preference.**
 * A referral submission is not idempotent: a retried `POST` that actually
 * succeeded the first time books the household twice and takes two places on a
 * session. It is also rate limited at roughly five per IP per minute. The
 * screen surfaces the failure and the referrer decides; nothing here decides
 * for them.
 *
 * **Nothing is invalidated on success.** There is no cache of this referrer's
 * referrals to refresh — they have no account and no way back to it — and the
 * public session list they chose from is stale by exactly one place, which the
 * confirmation screen does not show. Inventing an invalidation here would be a
 * request spent on nobody's behalf.
 */
export function useSubmitReferral() {
  return useMutation({
    mutationFn: (submission: ReferralSubmission): Promise<ReferralReceipt> =>
      unwrap(publicApi.POST('/api/v1/public/referrals', { body: submission })),
    retry: false,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Referral maintenance — the staff-facing side. `api`, never `publicApi`: this
 * is authenticated, admin-and-team-lead work, unlike everything above.
 *
 * **`GET /referrals/{id}` genuinely exists and is not role-capped**, the same
 * shape as sessions rather than the users/stock/model-parcels "no single-item
 * GET" pattern — only the *fields* on the response are role-dependent
 * (`reasonId`, `referrerEmail`, `referrerPhone`; see `hasAdminFields` in
 * `referrals.logic.ts`), never whether the row can be fetched at all. So the
 * detail screen is a fetch of its own, cached and kept current with
 * `setQueryData`, exactly like `useSession`.
 * ---------------------------------------------------------------------------
 */

export type Referral = components['schemas']['Referral'];
export type RepeatReferralList = components['schemas']['RepeatReferralList'];
export type RepeatReferralMatch = components['schemas']['RepeatReferralMatch'];

/**
 * One PATCH shape covers both an ordinary amend and a move: `sessionId` and
 * `acknowledgeOverCapacity` are additive to `ReferralSelfAmend`, so sending
 * neither is a plain field amend and sending `sessionId` is a move. The two
 * screens that use this send disjoint subsets of the same type rather than
 * needing two.
 */
type ReferralPatchBody =
  paths['/api/v1/referrals/{id}']['patch']['requestBody']['content']['application/json'];
export type AmendReferralInput = ReferralPatchBody;
export type ReferralSearchRequest = components['schemas']['ReferralSearchRequest'];
export type ReferralSearchResponse = components['schemas']['ReferralSearchResponse'];

async function fetchReferrals(filters: ReferralListFilters): Promise<Referral[]> {
  const { referrals } = await unwrap(api.GET('/api/v1/referrals', { params: { query: filters } }));
  return sortReferrals(referrals);
}

/**
 * `sessionId` and `status` are the only filters the endpoint takes — see
 * `ReferralListFilters`'s own comment for why nothing free-text is offered.
 */
export function useReferrals(filters: ReferralListFilters = {}) {
  return useQuery({
    queryKey: referralKeys.list(filters),
    queryFn: () => fetchReferrals(filters),
  });
}

/** Not capped by role, and not a projection over the list — see the module comment. A stale or invented id is a plain `404`. */
export function useReferral(id: string) {
  return useQuery({
    queryKey: referralKeys.detail(id),
    queryFn: () => unwrap(api.GET('/api/v1/referrals/{id}', { params: { path: { id } } })),
  });
}

/**
 * The count is part of `Referral`; the matching household details are a
 * deliberately separate, admin-only request. Keeping this query disabled
 * until the administrator asks means names, addresses, dates of birth and
 * phone numbers are not fetched merely because a referral detail page opened.
 */
export function useRepeatReferrals(id: string, excludePostcode: boolean, enabled: boolean) {
  return useQuery({
    queryKey: referralKeys.repeatReferrals(id, excludePostcode),
    queryFn: (): Promise<RepeatReferralList> =>
      unwrap(
        api.GET('/api/v1/referrals/{id}/repeat-referrals', {
          params: { path: { id }, query: { excludePostcode: excludePostcode ? 'true' : 'false' } },
        }),
      ),
    enabled,
  });
}

export function useReferralSearch() {
  return useMutation({
    mutationFn: (body: ReferralSearchRequest): Promise<ReferralSearchResponse> =>
      unwrap(api.POST('/api/v1/referrals/search', { body })),
  });
}

/**
 * Backs both the "edit details" form and the "move to another session" panel
 * on the detail screen — see `AmendReferralInput`.
 *
 * **Also invalidates `sessionKeys`**, imported from the sessions feature's
 * `keys.ts` rather than its `queries.ts`. `Session.booked` is derived from
 * exactly this data — moving a referral in or out of a session, or amending
 * one that changes nothing about the session, still changes what `booked`
 * means for the session(s) involved — so a referral mutation that left the
 * sessions cache alone would show a stale occupancy count on the very screen
 * an admin used to decide the move was safe. `sessionKeys.lists()` covers the
 * planning list; `sessionKeys.detail(updated.sessionId)` covers the session
 * this referral now belongs to.
 *
 * **`previousSessionId` is optional and caller-supplied, not read off a
 * cache.** A move changes which session a referral belongs to, so the session
 * it left also needs invalidating — but the mutation only gets `updated` back,
 * which carries the *new* `sessionId`, and this file has no reliable way to
 * recover the old one after the fact (the detail cache has already been
 * overwritten by the time `onSuccess` runs). `MovePanel` already has the row
 * on screen before it submits, so it is the cheapest place to carry that id
 * through rather than this hook re-deriving it from a cache that might not
 * even hold it.
 */
export function useAmendReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: AmendReferralInput;
      previousSessionId?: string;
    }): Promise<Referral> =>
      unwrap(api.PATCH('/api/v1/referrals/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(referralKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(updated.sessionId) });
      if (
        variables.previousSessionId !== undefined &&
        variables.previousSessionId !== updated.sessionId
      ) {
        void queryClient.invalidateQueries({
          queryKey: sessionKeys.detail(variables.previousSessionId),
        });
      }
    },
  });
}

export type ReviewDecision = 'accept' | 'reject';

/**
 * Accept or reject a referral waiting on an administrator, with the one line of
 * comment `screenDetails.md` asks for.
 *
 * **Both invalidate `sessionKeys`, and rejecting is the reason.** A
 * `pending_review` referral holds its place on the session, so rejecting it
 * releases one and changes `Session.booked` on the very screen an admin might
 * be using to decide whether there is room for the next one. Accepting takes no
 * further capacity — the place was already held — but it moves the referral
 * into the set a pick list will generate from, so the session's caches are
 * stale either way.
 *
 * **Not idempotent, unlike cancel.** A second accept of an already-accepted
 * referral is a `409`, whose message is written to be shown; the screen refuses
 * up front for the case that is already certain and shows the `409` verbatim
 * for the one that races another administrator.
 */
export function useReviewReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: ReviewDecision;
      comment: string;
    }): Promise<Referral> => {
      const path =
        decision === 'accept' ? '/api/v1/referrals/{id}/accept' : '/api/v1/referrals/{id}/reject';
      return unwrap(
        api.POST(path, {
          params: { path: { id } },
          // An empty comment is dropped rather than sent as `''` — the same
          // choice `useCancelReferral` makes. The server's own bound is
          // `minLength: 1`, so `''` would be a `400` for a field nobody filled in.
          body: comment.trim() === '' ? {} : { comment: comment.trim() },
        }),
      );
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(referralKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(updated.sessionId) });
    },
  });
}

/**
 * Records the separate reading pass for a referral whose booking was already
 * accepted. Unlike accepting or rejecting, this changes no session capacity;
 * it only removes the row from the administrator's active review pile.
 */
export function useMarkReferralReviewed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<Referral> =>
      unwrap(api.POST('/api/v1/referrals/{id}/review', { params: { path: { id } } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(referralKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
    },
  });
}

/**
 * Idempotent on the server — a second cancel of an already-cancelled referral
 * still answers `200` with the same row — so this hook does not need to guard
 * against a double click the way the shop's purchase submit does.
 */
export function useCancelReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }): Promise<Referral> =>
      unwrap(
        api.POST('/api/v1/referrals/{id}/cancel', {
          params: { path: { id } },
          // An empty reason is dropped rather than sent as `''` — the same
          // choice `useCancelSession` makes, and for the same reason: an
          // admin who left it blank should not have a blank sentence saved
          // onto the referral's record for ever.
          body: reason === '' ? {} : { reason },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(referralKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(updated.sessionId) });
    },
  });
}
