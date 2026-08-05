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
 * Deliberately just `status`. `from`/`to` exist on the endpoint but this app
 * never sends them — see `queries.ts` for why leaving the window to the server
 * is the whole point of the admin/team-lead split.
 */
export interface SessionListFilters {
  readonly status?: SessionStatus;
}

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionKeys.all, 'list'] as const,
  list: (filters: SessionListFilters) => [...sessionKeys.lists(), filters] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
  recurring: () => [...sessionKeys.all, 'recurring'] as const,
};
