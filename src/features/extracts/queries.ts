import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { extractKeys } from './keys';

export type ExtractConfig =
  paths['/api/v1/extracts/config']['get']['responses'][200]['content']['application/json'];
export type ExtractClaimResponse =
  paths['/api/v1/extracts/claims']['post']['responses'][200]['content']['application/json'];
export type ExtractCompleteResponse =
  paths['/api/v1/extracts/claims/{claimId}/complete']['post']['responses'][200]['content']['application/json'];
export type ExtractRow = components['schemas']['ExtractRow'];
export type ExtractClaim = components['schemas']['ExtractClaim'];

export function useExtractConfig(enabled: boolean) {
  return useQuery({
    queryKey: extractKeys.config(),
    queryFn: (): Promise<ExtractConfig> => unwrap(api.GET('/api/v1/extracts/config')),
    enabled,
  });
}

export function useExtractClaim() {
  return useMutation({
    mutationFn: (): Promise<ExtractClaimResponse> => unwrap(api.POST('/api/v1/extracts/claims')),
  });
}

export function useCompleteExtractClaim() {
  return useMutation({
    mutationFn: (claimId: string): Promise<ExtractCompleteResponse> =>
      unwrap(
        api.POST('/api/v1/extracts/claims/{claimId}/complete', { params: { path: { claimId } } }),
      ),
  });
}
