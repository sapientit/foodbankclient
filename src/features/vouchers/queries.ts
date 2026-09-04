import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { voucherKeys } from './keys';

export type VoucherConfig = components['schemas']['VoucherConfig'];
type VoucherConfigInput =
  paths['/api/v1/voucher-config']['put']['requestBody']['content']['application/json'];

export function useVoucherConfig() {
  return useQuery({
    queryKey: voucherKeys.config(),
    queryFn: (): Promise<VoucherConfig> => unwrap(api.GET('/api/v1/voucher-config')),
  });
}

export function useSaveVoucherConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VoucherConfigInput): Promise<VoucherConfig> =>
      unwrap(api.PUT('/api/v1/voucher-config', { body })),
    onSuccess: (config) => {
      queryClient.setQueryData(voucherKeys.config(), config);
    },
  });
}
