import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { platformStatsKeys } from './keys';

export type PlatformStatsDay = components['schemas']['PlatformStatsDay'];

export function usePlatformUsage(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: platformStatsKeys.usage(from, to),
    enabled,
    queryFn: () =>
      unwrap(api.GET('/api/v1/platform-stats/usage', { params: { query: { from, to } } })),
  });
}

/** The administrator dashboard's count for the server-defined fourteen-day window. */
export function usePlatformUsageAlertSummary(enabled: boolean) {
  return useQuery({
    queryKey: platformStatsKeys.alertSummary(),
    enabled,
    queryFn: () => unwrap(api.GET('/api/v1/platform-stats/usage/alert-summary')),
  });
}
