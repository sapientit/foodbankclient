import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { stockKeys } from './keys';

/**
 * The only import boundary for stock data — items, levels, autocomplete, hand
 * adjustments, shops and stock takes.
 *
 * Two lists, one key root. See `keys.ts` for why they are not allowed to drift
 * apart: an item mutation reorders the levels list, so every mutation here
 * invalidates `stockKeys.all`.
 *
 * There is no single-item GET for either list, so the amend screen and the
 * adjustment screen are both projections of a list query rather than fetches of
 * their own. Both lists are fetched with `includeInactive=true` and split
 * client-side, because a retired item still holds its name and its balance.
 */

export type StockItem = components['schemas']['StockItem'];
export type StockLevel = components['schemas']['StockLevel'];

type StockTakeBody =
  paths['/api/v1/stock/take']['post']['requestBody']['content']['application/json'];

export type StockTakeCount = StockTakeBody['counts'][number];
export type StockTakeResult =
  paths['/api/v1/stock/take']['post']['responses']['200']['content']['application/json'];

export interface StockItemInput {
  readonly name: string;
  readonly shelfNumber: string;
}

async function fetchStockItems(): Promise<StockItem[]> {
  const { items } = await unwrap(
    api.GET('/api/v1/stock/items', { params: { query: { includeInactive: 'true' } } }),
  );

  // The API orders by shelf. Preserve that order instead of duplicating its
  // shelf-sort rule in the browser.
  return [...items];
}

async function fetchStockLevels(): Promise<StockLevel[]> {
  const { items } = await unwrap(
    api.GET('/api/v1/stock/levels', { params: { query: { includeInactive: 'true' } } }),
  );

  /*
   * **Server order, never re-sorted.** The server derives a `shelfSortKey` that
   * zero-pads the numeric run, so it answers `A1, A2, A10` — the order a picker
   * walks the aisle in. A `sort()` on `shelfNumber` here would put `A10` second
   * and send somebody back down the aisle.
   */
  return [...items];
}

export function useStockItems() {
  return useQuery({ queryKey: stockKeys.items(), queryFn: fetchStockItems });
}

export function useStockItem(id: string) {
  return useQuery({
    queryKey: stockKeys.items(),
    queryFn: fetchStockItems,
    select: (items: StockItem[]) => items.find((item) => item.id === id) ?? null,
  });
}

export function useStockLevels() {
  return useQuery({ queryKey: stockKeys.levels(), queryFn: fetchStockLevels });
}

export function useStockLevel(id: string) {
  return useQuery({
    queryKey: stockKeys.levels(),
    queryFn: fetchStockLevels,
    select: (levels: StockLevel[]) => levels.find((level) => level.id === id) ?? null,
  });
}

export function useCreateStockItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: StockItemInput) => unwrap(api.POST('/api/v1/stock/items', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

export function useAmendStockItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: StockItemInput | { isActive: boolean } }) =>
      unwrap(api.PATCH('/api/v1/stock/items/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

/**
 * The autocomplete's bounds, straight from the contract: `q` is `minLength: 1,
 * maxLength: 40`. **Forty is an error, not an empty result** — the database
 * limits the pattern length — so the input is capped rather than the query being
 * allowed to fail.
 */
export const SEARCH_MIN_LENGTH = 1;
export const SEARCH_MAX_LENGTH = 40;

async function searchStockItems(term: string): Promise<StockItem[]> {
  const { items } = await unwrap(
    api.GET('/api/v1/stock/search', { params: { query: { q: term } } }),
  );

  /*
   * **Server order, never re-sorted — and it is not shelf order.** The server
   * matches on prefix, falls back to infix only when the prefix found nothing,
   * caps at twenty and returns them **alphabetically**. That is right for a
   * person typing a name and wrong for a person walking an aisle, which is why
   * this list and the levels list are ordered differently on purpose.
   */
  return [...items];
}

/**
 * Type `sug`, get `Sugar`. Idle until there is something to ask about, and
 * capped so an over-long term is never sent.
 */
export function useStockSearch(term: string) {
  return useQuery({
    queryKey: stockKeys.search(term),
    queryFn: () => searchStockItems(term),
    enabled: term.length >= SEARCH_MIN_LENGTH && term.length <= SEARCH_MAX_LENGTH,
  });
}

/** Save one independently resumable page of a weekly stock take. */
export function useSaveStockTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (counts: readonly StockTakeCount[]): Promise<StockTakeResult> =>
      unwrap(api.POST('/api/v1/stock/take', { body: { counts: [...counts] } })),
    onSuccess: () => {
      // A saved count replaces each named item's history, so the levels list is
      // stale even though the response supplies the saved rows for this page.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}
