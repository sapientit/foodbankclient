/**
 * The query keys this feature owns. Structured, exported, and never written
 * inline at a call site — an invalidation that misses its key is a screen
 * showing yesterday's data.
 *
 * **There is exactly one list entry, and `includeInactive` is not part of the
 * key** because it never varies: the list is always fetched including retired
 * accounts and split client-side. See `queries.ts` for why that is forced rather
 * than chosen.
 */
export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
};
