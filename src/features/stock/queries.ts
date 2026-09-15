import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap, unwrapVoid } from '../../api/unwrap';
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

export type StockTakeCount = NonNullable<StockTakeBody['counts']>[number];
export type StockTakeCrateCount = NonNullable<StockTakeBody['crateCounts']>[number];
export type StockTakeResult =
  paths['/api/v1/stock/take']['post']['responses']['200']['content']['application/json'];

type StockCorrectionBody =
  paths['/api/v1/stock/items/{id}/corrections']['post']['requestBody']['content']['application/json'];

export type StockTakeGrouping = components['schemas']['StockTakeGrouping'];
export type Crate = components['schemas']['Crate'];
export type StockValidationIssue = components['schemas']['StockValidationIssue'];
export type CrateInput = components['schemas']['CrateInput'];
export type CratePatchInput = components['schemas']['CratePatchInput'];

export type StockItemCreateInput =
  paths['/api/v1/stock/items']['post']['requestBody']['content']['application/json'];
export type StockItemPatch =
  paths['/api/v1/stock/items/{id}']['patch']['requestBody']['content']['application/json'];

async function fetchStockItems(order: 'category' | 'shelf'): Promise<StockItem[]> {
  const { items } = await unwrap(
    api.GET('/api/v1/stock/items', { params: { query: { includeInactive: 'true', order } } }),
  );

  // The server owns both orderings, including plain string shelf order.
  return [...items];
}

async function fetchStockLevels(): Promise<StockLevel[]> {
  const { items } = await unwrap(
    api.GET('/api/v1/stock/levels', { params: { query: { includeInactive: 'true' } } }),
  );

  // Server order, never re-sorted: shelf labels compare as plain strings, so
  // `A10` comes before `A2`.
  return [...items];
}

export function useStockItems(order: 'category' | 'shelf' = 'category') {
  return useQuery({
    queryKey: stockKeys.items(order),
    queryFn: () => fetchStockItems(order),
  });
}

export function useStockItem(id: string) {
  return useQuery({
    queryKey: stockKeys.items(),
    queryFn: () => fetchStockItems('category'),
    select: (items: StockItem[]) => items.find((item) => item.id === id) ?? null,
  });
}

export function useStockLevels() {
  return useQuery({ queryKey: stockKeys.levels(), queryFn: fetchStockLevels });
}

export function useStockTakeGroupings() {
  return useQuery({
    queryKey: stockKeys.groupings(),
    queryFn: async (): Promise<StockTakeGrouping[]> => {
      const { items } = await unwrap(api.GET('/api/v1/stock/groupings'));
      return [...items];
    },
  });
}

export function useCrates() {
  return useQuery({
    queryKey: stockKeys.crates(),
    queryFn: async (): Promise<Crate[]> => {
      const { items } = await unwrap(api.GET('/api/v1/stock/crates'));
      return [...items];
    },
  });
}

export function useStockValidation() {
  return useQuery({
    queryKey: stockKeys.validation(),
    queryFn: fetchStockValidation,
  });
}

async function fetchStockValidation(): Promise<StockValidationIssue[]> {
  const { issues } = await unwrap(api.GET('/api/v1/stock/validation'));
  return [...issues];
}

/** Validation reports a saved transitional state; it never turns a successful edit into a failure. */
function refreshValidation(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient
    .fetchQuery({
      queryKey: stockKeys.validation(),
      queryFn: fetchStockValidation,
    })
    .catch(() => undefined);
}

export function useCreateStockTakeGrouping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.POST('/api/v1/stock/groupings', { body: { name } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

export function useAmendStockTakeGrouping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { readonly id: string; readonly name: string }) =>
      unwrap(
        api.PATCH('/api/v1/stock/groupings/{id}', { params: { path: { id } }, body: { name } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

export function useCreateCrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrateInput) => {
      const crate = await unwrap(api.POST('/api/v1/stock/crates', { body: input }));
      await setDirectGrouping(
        input.members.map((member) => member.stockItemId),
        null,
      );
      return crate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

export function useAmendCrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      previous,
    }: {
      readonly id: string;
      readonly patch: CratePatchInput;
      readonly previous: Crate;
    }) => {
      const crate = await unwrap(
        api.PATCH('/api/v1/stock/crates/{id}', { params: { path: { id } }, body: patch }),
      );
      if (patch.members === undefined) return crate;

      const previousIds = new Set(previous.members.map((member) => member.stockItemId));
      const memberIds = new Set(patch.members.map((member) => member.stockItemId));
      await setDirectGrouping(
        patch.members
          .map((member) => member.stockItemId)
          .filter((stockItemId) => !previousIds.has(stockItemId)),
        null,
      );
      await setDirectGrouping(
        previous.members
          .map((member) => member.stockItemId)
          .filter((stockItemId) => !memberIds.has(stockItemId)),
        crate.groupingId,
      );
      return crate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

export function useDeleteCrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (crate: Crate) => {
      // DELETE is deliberately idempotent and returns 204, so it has no body to unwrap.
      await unwrapVoid(
        api.DELETE('/api/v1/stock/crates/{id}', { params: { path: { id: crate.id } } }),
      );
      await setDirectGrouping(
        crate.members.map((member) => member.stockItemId),
        crate.groupingId,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

/** The admin dashboard's server-computed count of active watched items below threshold. */
export function useLowStockSummary(enabled: boolean) {
  return useQuery({
    queryKey: stockKeys.lowStockSummary(),
    enabled,
    queryFn: () => unwrap(api.GET('/api/v1/stock/items/low-stock-summary')),
  });
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
    mutationFn: (input: StockItemCreateInput) =>
      unwrap(api.POST('/api/v1/stock/items', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

export function useAmendStockItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: StockItemPatch }) =>
      unwrap(api.PATCH('/api/v1/stock/items/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      refreshValidation(queryClient);
    },
  });
}

/** Correct one level between stock takes. A Set operation gets a fresh level before deriving its delta. */
export function useCorrectStockLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      stockItemId,
      operation,
      quantity,
    }: {
      readonly stockItemId: string;
      readonly operation: 'set' | 'add' | 'reduce';
      readonly quantity: number;
    }) => {
      const quantityDelta =
        operation === 'set'
          ? await freshSetDelta(stockItemId, quantity)
          : operation === 'add'
            ? quantity
            : -quantity;
      return unwrap(
        api.POST('/api/v1/stock/items/{id}/corrections', {
          params: { path: { id: stockItemId } },
          body: { quantityDelta } satisfies StockCorrectionBody,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

async function freshSetDelta(stockItemId: string, quantity: number): Promise<number> {
  const current = (await fetchStockLevels()).find((level) => level.id === stockItemId);
  if (current === undefined) throw new Error('That stock item no longer exists.');
  return quantity - current.quantityOnHand;
}

/** A crate member is counted by its crate; a former member resumes direct counting in this grouping. */
async function setDirectGrouping(
  stockItemIds: readonly string[],
  groupingId: string | null,
): Promise<void> {
  await Promise.all(
    stockItemIds.map(async (stockItemId) => {
      await unwrap(
        api.PATCH('/api/v1/stock/items/{id}', {
          params: { path: { id: stockItemId } },
          body: { groupingId },
        }),
      );
    }),
  );
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

export type VolunteerCode =
  paths['/api/v1/stock/take/volunteer-codes']['post']['responses']['201']['content']['application/json'];

/**
 * Mint a stock-take volunteer code for whoever is counting the shelves this
 * morning. Staff only (the server checks the signed token); the code is in the
 * response and nowhere else, so the screen shows it once and never refetches.
 * Nothing cached depends on it, so there is nothing to invalidate.
 */
export function useGenerateVolunteerCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<VolunteerCode> =>
      unwrap(api.POST('/api/v1/stock/take/volunteer-codes', {})),
    // A fresh code makes any dashboard warning about the earlier latest code
    // stale immediately; waiting for the normal one-minute cache would leave
    // an administrator acting on an alert that is no longer true.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stockKeys.latestVolunteerCode() }),
  });
}

export type LatestVolunteerCode =
  paths['/api/v1/stock/take/volunteer-codes/latest']['get']['responses']['200']['content']['application/json'];

/**
 * The dashboard asks the server whether the latest code is close to its own
 * expiry. It deliberately never receives the code: that was visible only at
 * generation time and cannot safely be retrieved later.
 */
export function useLatestVolunteerCode(enabled: boolean) {
  return useQuery({
    queryKey: stockKeys.latestVolunteerCode(),
    queryFn: (): Promise<LatestVolunteerCode> =>
      unwrap(api.GET('/api/v1/stock/take/volunteer-codes/latest')),
    enabled,
  });
}

/** Save one independently resumable page of a weekly stock take. */
export function useSaveStockTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      counts,
      crateCounts,
    }: {
      readonly counts: readonly StockTakeCount[];
      readonly crateCounts: readonly StockTakeCrateCount[];
    }): Promise<StockTakeResult> =>
      unwrap(
        api.POST('/api/v1/stock/take', {
          body: { counts: [...counts], crateCounts: [...crateCounts] },
        }),
      ),
    onSuccess: () => {
      // A saved count replaces each named item's history, so the levels list is
      // stale even though the response supplies the saved rows for this page.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}
