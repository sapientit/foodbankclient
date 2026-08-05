import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { authorisedReferrerKeys, referralReasonKeys } from './keys';
import { sortAuthorisedReferrers, sortReferralReasons } from './admin-setup.logic';

/**
 * The only import boundary for authorised referrers and reasons for
 * referral — the server's "Admin setup" tag, both admin-only maintenance
 * lookups with **no single-item `GET`**. The amend screens are projections
 * over these two list queries, the same shape `useUser` and `useModelParcel`
 * are.
 *
 * **Both endpoints return everything unconditionally** — there is no
 * `includeInactive` param to get wrong the way `users.ts` has one. An
 * inactive authorised referrer is not filterable at all on the server's
 * side, which matches what `openapi.yaml` says in terms: "Never filter
 * these out."
 */

export type AuthorisedReferrer = components['schemas']['AuthorisedReferrer'];
export type AdminReferralReason = components['schemas']['AdminReferralReason'];

type CreateReferrerBody =
  paths['/api/v1/authorised-referrers']['post']['requestBody']['content']['application/json'];
export type CreateAuthorisedReferrerInput = CreateReferrerBody;

type AmendReferrerBody =
  paths['/api/v1/authorised-referrers/{id}']['patch']['requestBody']['content']['application/json'];
export type AmendAuthorisedReferrerInput = AmendReferrerBody;

type CreateReasonBody =
  paths['/api/v1/referral-reasons']['post']['requestBody']['content']['application/json'];
export type CreateReferralReasonInput = CreateReasonBody;

type AmendReasonBody =
  paths['/api/v1/referral-reasons/{id}']['patch']['requestBody']['content']['application/json'];
export type AmendReferralReasonInput = AmendReasonBody;

async function fetchAuthorisedReferrers(): Promise<AuthorisedReferrer[]> {
  const { authorisedReferrers } = await unwrap(api.GET('/api/v1/authorised-referrers'));
  return sortAuthorisedReferrers(authorisedReferrers);
}

export function useAuthorisedReferrers() {
  return useQuery({ queryKey: authorisedReferrerKeys.list(), queryFn: fetchAuthorisedReferrers });
}

/** A projection over the one list query — see the module comment for why there is no single-item `GET`. */
export function useAuthorisedReferrer(id: string) {
  return useQuery({
    queryKey: authorisedReferrerKeys.list(),
    queryFn: fetchAuthorisedReferrers,
    select: (rows: AuthorisedReferrer[]) => rows.find((row) => row.id === id) ?? null,
  });
}

export function useAuthoriseReferrer() {
  const queryClient = useQueryClient();

  return useMutation({
    /*
     * **`201` answers `{ id, matchValue }`, not the row this screen just
     * built.** No `organisationName`, no `isActive`, no `notes` — there is
     * nothing here to splice into the cached list the way `users.ts` and
     * `model-parcels.ts` do with their mutation responses, so this
     * invalidates and lets the next render's refetch supply the real row.
     * See `CLAUDE.md`'s admin-setup slice entry for why that is the
     * contract's shape rather than a shortcut taken here.
     */
    mutationFn: (input: CreateAuthorisedReferrerInput) =>
      unwrap(api.POST('/api/v1/authorised-referrers', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: authorisedReferrerKeys.all });
    },
  });
}

export function useAmendAuthorisedReferrer() {
  const queryClient = useQueryClient();

  return useMutation({
    // `200` answers `{ id, isActive }` — same reasoning as create above.
    mutationFn: ({ id, patch }: { id: string; patch: AmendAuthorisedReferrerInput }) =>
      unwrap(
        api.PATCH('/api/v1/authorised-referrers/{id}', { params: { path: { id } }, body: patch }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: authorisedReferrerKeys.all });
    },
  });
}

async function fetchReferralReasons(): Promise<AdminReferralReason[]> {
  const { referralReasons } = await unwrap(api.GET('/api/v1/referral-reasons'));
  return sortReferralReasons(referralReasons);
}

/**
 * `enabled` defaults to `true` for every existing caller in this feature.
 * It exists for the referrals screens: `GET /referral-reasons` is admin-only
 * (the same "Admin setup" tag as the referrer endpoints), and a team lead
 * legitimately opens a referral to read it — see `hasAdminFields` in
 * `referrals.logic.ts`. Firing this query anyway would spend a request on a
 * `403` for a field this client already knows it will not render.
 */
export function useReferralReasons(enabled = true) {
  return useQuery({
    queryKey: referralReasonKeys.list(),
    queryFn: fetchReferralReasons,
    enabled,
  });
}

/** A projection over the one list query — see the module comment. */
export function useReferralReason(id: string) {
  return useQuery({
    queryKey: referralReasonKeys.list(),
    queryFn: fetchReferralReasons,
    select: (rows: AdminReferralReason[]) => rows.find((row) => row.id === id) ?? null,
  });
}

export function useCreateReferralReason() {
  const queryClient = useQueryClient();

  return useMutation({
    // Unlike the referrer endpoints, `201` here answers the full
    // `AdminReferralReason` — but this module invalidates rather than
    // splices anyway, for one consistent pattern across both resources
    // rather than an asymmetry that exists only because one response
    // shape happens to allow more. See the module comment on `queries.ts`.
    mutationFn: (input: CreateReferralReasonInput) =>
      unwrap(api.POST('/api/v1/referral-reasons', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralReasonKeys.all });
    },
  });
}

export function useAmendReferralReason() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AmendReferralReasonInput }) =>
      unwrap(api.PATCH('/api/v1/referral-reasons/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralReasonKeys.all });
    },
  });
}
