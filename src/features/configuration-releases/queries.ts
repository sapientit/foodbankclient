import { useMutation, useQuery } from '@tanstack/react-query';
import { api, publicApi } from '../../api/client';
import type { components } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { configurationReleaseKeys } from './keys';

export type PublicQuestionnaire = components['schemas']['PublicQuestionnaire'];
export type WorkbookConfig = components['schemas']['WorkbookConfig'];
export type ConfigurationRelease = components['schemas']['ConfigurationRelease'];
export type ConfigurationReleaseSummary = components['schemas']['ConfigurationReleaseSummary'];
export type ConfigurationReleaseUpload = components['schemas']['ConfigurationReleaseUpload'];

/**
 * The active release's questionnaire, for the public form — `questionnaire`
 * is a JSON string, exactly as uploaded, never parsed by the server. Rules
 * are never in this response; they are not for the public.
 */
export function usePublicQuestionnaire() {
  return useQuery({
    queryKey: configurationReleaseKeys.publicQuestionnaire(),
    queryFn: (): Promise<PublicQuestionnaire> =>
      unwrap(publicApi.GET('/api/v1/public/questionnaire')),
  });
}

/**
 * The releases named by a set of referrals' own `formId`s, in one call.
 *
 * `admin` and `team_lead` get `questionnaire` and `rules` both; `fuel_admin`
 * gets `questionnaire` only — `rules` is absent from the response, not
 * `null`, because that role never evaluates a preference rule.
 *
 * A plain function rather than only a hook, so a mutation — which cannot call
 * a hook — can fetch the same way `usePreparePickLists` does, keyed on the
 * same distinct-`formId`s pattern.
 */
export async function fetchConfigurationReleasesBulk(
  formIds: readonly string[],
): Promise<readonly ConfigurationRelease[]> {
  const { releases } = await unwrap(
    api.GET('/api/v1/configuration-releases/bulk', {
      params: { query: { formIds: formIds.join(',') } },
    }),
  );
  return releases;
}

/**
 * The hook a screen with several referrals in front of it — a pick list, the
 * fuel help list — uses once it has collected the distinct ids, rather than
 * asking once per referral. `enabled` is off for an empty list: nothing to
 * render yet is not the same request as "every release".
 */
export function useConfigurationReleasesBulk(formIds: readonly string[]) {
  return useQuery({
    queryKey: configurationReleaseKeys.bulk(formIds),
    queryFn: () => fetchConfigurationReleasesBulk(formIds),
    enabled: formIds.length > 0,
  });
}

/**
 * Where the configuration workbook is and which Google OAuth client to ask
 * Sheets consent against — the same client `/extracts/config` names.
 * `configured: false` (both other fields absent) until the deployment sets
 * both, which as of this release is every environment.
 */
export function useConfigurationWorkbookConfig(enabled: boolean) {
  return useQuery({
    queryKey: configurationReleaseKeys.workbookConfig(),
    queryFn: (): Promise<WorkbookConfig> =>
      unwrap(api.GET('/api/v1/configuration-releases/config')),
    enabled,
  });
}

/**
 * Uploads a validated, confirmed bundle as a new draft. The server stores it
 * verbatim — it does not parse, validate or execute either document, so
 * everything that could refuse this bundle has already run in the browser
 * before this is called.
 */
export function useUploadConfigurationRelease() {
  return useMutation({
    mutationFn: (body: ConfigurationReleaseUpload): Promise<ConfigurationRelease> =>
      unwrap(api.POST('/api/v1/configuration-releases', { body })),
  });
}

/** Publishes a draft, atomically superseding whichever release is currently active. */
export function usePublishConfigurationRelease() {
  return useMutation({
    mutationFn: (formId: string): Promise<ConfigurationRelease> =>
      unwrap(
        api.POST('/api/v1/configuration-releases/{formId}/publish', {
          params: { path: { formId } },
        }),
      ),
  });
}
