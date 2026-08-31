import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap, unwrapVoid } from '../../api/unwrap';
import { targetStockListKeys } from './keys';
import { sortTargetStockLists } from './target-stock-lists.logic';

/**
 * The only import boundary for target stock lists — the named standing lists of
 * desired stock levels an administrator maintains and a team lead shops
 * against.
 *
 * Modelled on `model-parcels/queries.ts`: a list, a create, an amend and a
 * delete, **no `GET /{id}`** — the amend screen is a projection over the one
 * cached list, the same as `useModelParcel` / `useStockItem`.
 *
 * The contract is settled (server Q44–Q48, all closed 2026-08-31): `lines` are
 * stored verbatim with a name snapshot and no catalogue validation, so the
 * client reconciles them; a `name` is amendable; and a team lead reads a list's
 * raw `lines`, so `shopping-list.logic.ts` computes the buy list in the browser.
 */

export type TargetStockList = components['schemas']['TargetStockList'];
export type TargetStockLine = components['schemas']['TargetStockLine'];

export type CreateTargetStockListInput =
  paths['/api/v1/target-stock-lists']['post']['requestBody']['content']['application/json'];
export type AmendTargetStockListInput =
  paths['/api/v1/target-stock-lists/{id}']['patch']['requestBody']['content']['application/json'];

async function fetchTargetStockLists(): Promise<TargetStockList[]> {
  const { targetStockLists } = await unwrap(api.GET('/api/v1/target-stock-lists'));

  // The endpoint makes no ordering promise, so maintenance order is this
  // client's own rule — by name, the same reasoning as `sortModelParcels`.
  return sortTargetStockLists(targetStockLists);
}

export function useTargetStockLists() {
  return useQuery({
    queryKey: targetStockListKeys.list(),
    queryFn: fetchTargetStockLists,
  });
}

/** A projection over the one list query — see the module comment for why there is no single-item `GET`. */
export function useTargetStockList(id: string) {
  return useQuery({
    queryKey: targetStockListKeys.list(),
    queryFn: fetchTargetStockLists,
    select: (lists: TargetStockList[]) => lists.find((list) => list.id === id) ?? null,
  });
}

export function useCreateTargetStockList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTargetStockListInput): Promise<TargetStockList> =>
      unwrap(api.POST('/api/v1/target-stock-lists', { body: input })),
    onSuccess: () => {
      // The Shopping screen's list picker reads the same root, so a list just
      // created has to be choosable there without a reload.
      void queryClient.invalidateQueries({ queryKey: targetStockListKeys.all });
    },
  });
}

export function useAmendTargetStockList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: AmendTargetStockListInput;
    }): Promise<TargetStockList> =>
      unwrap(
        api.PATCH('/api/v1/target-stock-lists/{id}', { params: { path: { id } }, body: patch }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: targetStockListKeys.all });
    },
  });
}

export function useDeleteTargetStockList() {
  const queryClient = useQueryClient();

  return useMutation({
    // `204`, and idempotent server-side — deleting an id that is already gone
    // still returns `204`, so there is no `404` branch to handle here.
    mutationFn: (id: string) =>
      unwrapVoid(api.DELETE('/api/v1/target-stock-lists/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: targetStockListKeys.all });
    },
  });
}
