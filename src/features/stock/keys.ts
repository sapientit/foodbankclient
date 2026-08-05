/**
 * The query keys the stock module owns. One root, and that is the point.
 *
 * `stock` is a single server module, and its two lists are not independent:
 * adding an item makes a row appear in the levels list, and changing an item's
 * **shelf number reorders it**, because the server sorts both lists by a derived
 * shelf key. So an item mutation has to invalidate levels. Two disjoint roots —
 * which is what this feature had while it was `stock-items/` — cannot invalidate
 * each other, and the bug that follows is a levels screen showing the old shelf
 * order. No test that renders one screen would ever see it.
 *
 * Mutations therefore invalidate `stockKeys.all` rather than the one list they
 * obviously touched. There are two lists and they refetch in a second; being
 * clever here buys nothing and costs correctness.
 *
 * Neither list key carries `includeInactive`: it never varies. Both are always
 * fetched including retired items and split client-side, because a retired item
 * still holds its name — so the duplicate-name check needs it — and still has a
 * ledger balance a stock take has to account for.
 */
export const stockKeys = {
  all: ['stock'] as const,
  items: () => [...stockKeys.all, 'items'] as const,
  levels: () => [...stockKeys.all, 'levels'] as const,

  /**
   * One entry per search term, which is what makes a slow answer for `sug`
   * unable to land on top of a fresh answer for `sugar`: they are two cache
   * entries, not one variable being raced. The same reasoning as the referrer
   * check keying on the address.
   */
  search: (term: string) => [...stockKeys.all, 'search', term] as const,

  /**
   * The stock take list, and it is a list only. There is **no
   * `GET /stock/takes/{id}`**, so there is no detail key to add here and no
   * recorded count that can ever be read back — see `stock-take-screen.tsx` for
   * what that forces the screen to be.
   */
  takes: () => [...stockKeys.all, 'takes'] as const,
};
