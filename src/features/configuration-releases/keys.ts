/**
 * Query keys for referral form releases — the questionnaire and preference
 * rules the server stores as immutable, versioned bundles under a `formId`.
 *
 * Three unrelated things meet here, same reasoning as `referrals/keys.ts`
 * keeping the public and staff flows apart: the public questionnaire is
 * unauthenticated (`publicApi`); the bulk release read is admin, team_lead
 * and fuel_admin; the workbook config and the upload/publish actions are
 * admin only. See `queries.ts`.
 */
export const configurationReleaseKeys = {
  all: ['configuration-releases'] as const,
  publicQuestionnaire: () => [...configurationReleaseKeys.all, 'public-questionnaire'] as const,
  /** Sorted so the same set of ids in a different order hits the same cache entry. */
  bulk: (formIds: readonly string[]) =>
    [...configurationReleaseKeys.all, 'bulk', [...formIds].sort()] as const,
  history: () => [...configurationReleaseKeys.all, 'history'] as const,
  workbookConfig: () => [...configurationReleaseKeys.all, 'workbook-config'] as const,
};
