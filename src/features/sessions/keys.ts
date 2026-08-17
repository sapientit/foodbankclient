/**
 * The query keys the sessions module owns. One root.
 *
 * Unlike stock and users, sessions really do have a single-item `GET`, so the
 * list and the detail cache are genuinely separate resources here — there is no
 * fold-onto-one-root forced by a missing endpoint. They still share a root
 * object because they are one server module and one feature folder, and because
 * `sessionKeys.all` is the one thing every mutation in this file can safely
 * reach for without having to reason about which sub-tree it affects.
 *
 * Recurring sessions are a third, independent sub-tree. Amending a template
 * **does not** retrospectively change sessions already generated — `API.md`
 * section 4 and the server's `CLAUDE.md` both say so — so a recurring-session
 * mutation invalidates only `recurring()`, never `lists()`.
 */

export type SessionStatus = 'planned' | 'in_progress' | 'confirmed' | 'cancelled';

/**
 * Deliberately just the date window. `status` exists on the endpoint and this
 * app does not send it: the lists want *planned or in progress*, and the
 * parameter takes one value, so the narrowing is done on the response instead —
 * see `session-list-filters.logic.ts`.
 *
 * Both filters absent is a real and common call: `useSessions()` with no
 * arguments is how a screen resolves an arbitrary session id to a date, and it
 * must not be bounded by a window.
 */
export interface SessionListFilters {
  readonly from?: string;
  readonly to?: string;
}

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionKeys.all, 'list'] as const,
  list: (filters: SessionListFilters) => [...sessionKeys.lists(), filters] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
  recurring: () => [...sessionKeys.all, 'recurring'] as const,
};
