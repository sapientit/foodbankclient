import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { fuelHelpKeys } from './keys';

export type FuelHelpList =
  paths['/api/v1/fuel-help-list']['get']['responses'][200]['content']['application/json'];

export function useFuelHelpList() {
  return useQuery({
    queryKey: fuelHelpKeys.list(),
    queryFn: (): Promise<FuelHelpList> => unwrap(api.GET('/api/v1/fuel-help-list')),
  });
}
