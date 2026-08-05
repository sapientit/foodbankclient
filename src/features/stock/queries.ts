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
export type StockTake = components['schemas']['StockTake'];

type PurchaseBody =
  paths['/api/v1/stock/purchases']['post']['requestBody']['content']['application/json'];

export type PurchaseInput = PurchaseBody;
export type PurchaseLine = PurchaseBody['lines'][number];

/**
 * **Both fields are optional and must stay that way.** The `201` schema declares
 * no `required:`, so the generated type marks `purchaseId` and `lines` optional
 * — a `!` here would be the client asserting something the contract does not
 * say, on the one screen where being wrong costs money.
 */
export type PurchaseResult =
  paths['/api/v1/stock/purchases']['post']['responses']['201']['content']['application/json'];

type CountsBody =
  paths['/api/v1/stock/takes/{id}/counts']['post']['requestBody']['content']['application/json'];

export type StockCount = CountsBody['counts'][number];

export type CommitResult =
  paths['/api/v1/stock/takes/{id}/commit']['post']['responses']['200']['content']['application/json'];

/** One non-zero variance. Every field on it is optional in the contract. */
export type StockTakeAdjustment = NonNullable<CommitResult['adjustments']>[number];

type StockAdjustmentBody =
  paths['/api/v1/stock/adjustments']['post']['requestBody']['content']['application/json'];

/**
 * The six ways stock moves, taken straight off the generated union rather than
 * re-declared. The list is a `CHECK` constraint on a table the server cannot
 * alter without a rebuild, and the compiler is the only thing that will notice
 * if it ever changes. `expiry` used to be a seventh and is gone: anything thrown
 * away is `wastage`, whatever the reason it was thrown away.
 */
export type MovementType = StockAdjustmentBody['movementType'];

export type StockAdjustmentInput = StockAdjustmentBody;

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

/**
 * A shop: one request carrying every line.
 *
 * **There is no idempotency key.** The server mints a fresh `purchaseId` per
 * request, so two of these are two shops on the ledger — real money, wrong
 * stock, found out days later. Nothing in this hook can prevent that; the guard
 * is the synchronous ref lock at the call site, in `record-shop-screen.tsx`, and
 * this comment is here so nobody adds a retry to it.
 */
export function useRecordPurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PurchaseInput): Promise<PurchaseResult> =>
      unwrap(api.POST('/api/v1/stock/purchases', { body: input })),
    onSuccess: () => {
      // The whole point of a shop is that levels went up.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

export function useStockTakes() {
  return useQuery({
    queryKey: stockKeys.takes(),
    queryFn: async (): Promise<StockTake[]> => {
      const { stockTakes } = await unwrap(api.GET('/api/v1/stock/takes'));
      return [...stockTakes];
    },
  });
}

/**
 * Open a stock take.
 *
 * **The empty object is mandatory.** Every field on the body is optional, but
 * the handler parses the body rather than defaulting it, so sending nothing at
 * all is a `400`. `body: {}` is the whole fix and it looks like a mistake, which
 * is why it is commented here rather than at the call site.
 */
export function useOpenStockTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/stock/takes', { body: {} })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.takes() });
    },
  });
}

/**
 * Record counted quantities. **204, so `unwrapVoid`.**
 *
 * Nothing is invalidated, and that is not an omission: counts move no stock and
 * there is no endpoint that can read them back, so there is no cached answer
 * anywhere that this could make stale.
 */
export function useRecordCounts() {
  return useMutation({
    mutationFn: ({ id, counts }: { id: string; counts: readonly StockCount[] }) =>
      unwrapVoid(
        api.POST('/api/v1/stock/takes/{id}/counts', {
          params: { path: { id } },
          body: { counts: [...counts] },
        }),
      ),
  });
}

/** Commit the count. This is where a stock take moves stock. */
export function useCommitStockTake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<CommitResult> =>
      unwrap(api.POST('/api/v1/stock/takes/{id}/commit', { params: { path: { id } } })),
    onSuccess: () => {
      // Every variance became a `correction` on the ledger, and the take is no
      // longer open.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();

  return useMutation({
    /*
     * **204, so `unwrapVoid`.** `unwrap` would throw on a perfectly successful
     * adjustment, because `openapi-fetch` reports `data: undefined` for a body
     * that was never sent. That trap has its own named test in
     * `src/api/unwrap.test.ts`.
     */
    mutationFn: (input: StockAdjustmentInput) =>
      unwrapVoid(api.POST('/api/v1/stock/adjustments', { body: input })),
    onSuccess: () => {
      // The whole point of an adjustment is that a level changed.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}
