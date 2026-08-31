/**
 * The query keys the target-stock-lists module owns. One root, and nothing is
 * folded into it.
 *
 * A target stock list stores a stock item's id and a **snapshot of its name**,
 * never a live reference — so renaming or retiring a stock item deliberately
 * does *not* change a stored list, and a stock mutation has no reason to
 * invalidate anything here (nor the other way round). That is the opposite of
 * `stockKeys`, whose two lists reorder each other, and it is why this is its
 * own feature with its own root rather than another branch of `stock/`.
 *
 * The Shopping screen reads this list **and** `stockKeys.levels()` and joins
 * them in the browser to work out what to buy. The join lives in the component;
 * the two roots stay separate because neither invalidates the other.
 */
export const targetStockListKeys = {
  all: ['target-stock-lists'] as const,
  list: () => [...targetStockListKeys.all, 'list'] as const,
};
