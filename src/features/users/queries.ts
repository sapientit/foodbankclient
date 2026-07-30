import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { userKeys } from './keys';
import { sortByEmail } from './users.logic';

/**
 * The only import boundary for user data. Three endpoints, no `GET /users/{id}`
 * and no `DELETE` — both of those absences shape everything below.
 *
 * **One cache entry, always `includeInactive=true`.** Not an optimisation: with
 * no endpoint for a single user, the amend screen is a projection of the list,
 * and it has to be able to deep-link a *retired* row — reactivating one is the
 * main reason to open it. Fetching active-only would make that row unreachable.
 * So the list is fetched whole, once, and the active/retired split is done
 * client-side. `useUser` is a `select` over the same query rather than a second
 * request.
 *
 * **`includeInactive` never leaves this file.** The generated type is
 * `'true' | undefined`, and the server compares `!== 'true'` — so any other
 * value, including a boolean coerced anywhere on the way, silently means
 * active-only. One literal, in one place, is the whole defence.
 */

export type User = components['schemas']['User'];
export type Role = components['schemas']['Role'];

export interface CreateUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

/**
 * What a `PATCH` may change. **No `email`** — it is the login identity and what
 * the audit trail means by "who", and the server's patch schema is a plain
 * object that *silently strips* it. A bug that sent one would return 200 and
 * change nothing.
 */
export interface UserPatch {
  readonly displayName?: string;
  readonly role?: Role;
  readonly isActive?: boolean;
}

async function fetchUsers(): Promise<User[]> {
  const { users } = await unwrap(
    api.GET('/api/v1/users', { params: { query: { includeInactive: 'true' } } }),
  );

  return [...users];
}

export function useUsers() {
  return useQuery({ queryKey: userKeys.list(), queryFn: fetchUsers });
}

/**
 * One row from the list that is already cached. `null` means the id is not in
 * the list — a stale link, or a row someone else has never created — which the
 * amend screen renders as "no longer exists" rather than as a crash.
 */
export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: fetchUsers,
    select: (users: User[]) => users.find((user) => user.id === id) ?? null,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUserInput) => unwrap(api.POST('/api/v1/users', { body: input })),
    onSuccess: (created) => {
      spliceIntoList(queryClient, created);
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useAmendUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch }) =>
      unwrap(api.PATCH('/api/v1/users/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: (updated) => {
      spliceIntoList(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

/**
 * Refetches the list on demand, for the one case that is not a mutation: a `409`
 * the client did not predict. The lockout guards are a property of the whole
 * table, so a refusal we did not see coming is proof our copy of it is wrong.
 */
export function useRefreshUsers(): () => void {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: userKeys.all });
  }, [queryClient]);
}

/**
 * Both mutations answer with a bare user, so the cache is **spliced and then
 * invalidated**, and both halves earn their place.
 *
 * The splice is what keeps the screen correct at once — including the
 * last-active-admin refusal, which is a pure function of the whole array, so
 * every *other* row's controls depend on this one's new role. Waiting for a
 * refetch would leave those controls a round trip out of date.
 *
 * The invalidate is because that same predicate races other admins: another
 * browser may have promoted or retired somebody a second ago, and the server is
 * the only authority on who can still administer the food bank.
 */
function spliceIntoList(queryClient: QueryClient, user: User): void {
  queryClient.setQueryData<User[]>(userKeys.list(), (current) =>
    current === undefined
      ? undefined
      : sortByEmail([...current.filter((row) => row.id !== user.id), user]),
  );
}
