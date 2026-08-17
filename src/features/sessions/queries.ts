import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap } from '../../api/unwrap';
import { sessionKeys, type SessionListFilters } from './keys';
import { sortRecurringSessions, sortSessions } from './sessions.logic';

/**
 * The only import boundary for session data — the materialised list, one
 * session, ad hoc create/amend/cancel, and the weekly templates.
 *
 * **Unlike stock and users, `GET /sessions/{id}` genuinely exists and is not
 * capped by role** (`API.md` §2: "Not capped: `GET /sessions/{id}` and every
 * pick-list route"). So the detail screen is a real fetch of its own rather
 * than a projection over the list — there is no reason to fold the two the way
 * the stock items/levels split was, and no reason to splice a mutation's
 * response into a cached array the way the users screens do: `useSession`
 * already answers from its own cache entry, kept current with `setQueryData`.
 *
 * Recurring sessions have **no single-item `GET`** — only `list` and `patch` —
 * so `useRecurringSession` is a `select` projection over the list query, the
 * same shape as `useUser` in the users feature.
 */

export type Session = components['schemas']['Session'];
export type RecurringSession = components['schemas']['RecurringSession'];

type SessionCreateBody =
  paths['/api/v1/sessions']['post']['requestBody']['content']['application/json'];
export type CreateSessionInput = SessionCreateBody;

type SessionPatchBody =
  paths['/api/v1/sessions/{id}']['patch']['requestBody']['content']['application/json'];
export type AmendSessionInput = SessionPatchBody;

type RecurringCreateBody =
  paths['/api/v1/recurring-sessions']['post']['requestBody']['content']['application/json'];
export type CreateRecurringSessionInput = RecurringCreateBody;

/**
 * Derived from `paths`, like every other body here.
 *
 * This was hand-declared for one release: `openapi.yaml` used to give
 * `PATCH /recurring-sessions/{id}` a body of `{ type: object, minProperties: 1 }`
 * with no `properties:`, which generates `Record<string, never>` — a type that
 * refuses every real field. The spec now names them, so the hand-written
 * interface and the `@ts-expect-error` it needed are both gone. The unused
 * directive failing the build is what announced the fix.
 */
export type RecurringSessionPatch =
  paths['/api/v1/recurring-sessions/{id}']['patch']['requestBody']['content']['application/json'];

async function fetchSessions(filters: SessionListFilters): Promise<Session[]> {
  const { sessions } = await unwrap(api.GET('/api/v1/sessions', { params: { query: filters } }));
  return sortSessions(sessions);
}

/**
 * **The two session lists send a window; everything else sends nothing.**
 *
 * This client used to send no `from`/`to` at all, on the grounds that the
 * server derives the window from the caller's role — six weeks materialised for
 * an admin, today through today+6 for a team lead — so any window sent from
 * here would be guessing at a cap the token already carries. The far end of
 * that argument still holds and is why nothing here computes a horizon: a `to`
 * past the caller's is **clamped rather than refused**, so the lists send a
 * flat today+6 and let the server decide whether that is the whole of it.
 *
 * The near end does not hold any more. The server applies **no lower bound at
 * all**, which was harmless while the lists only ever showed open sessions and
 * is not once completed ones can be asked for — without a `from`, ticking
 * `Show completed` asks for every session the food bank has ever run. So the
 * lists bound the past themselves; see `session-list-filters.logic.ts`.
 *
 * `status` is still never sent, for a different reason: the parameter takes one
 * value and the lists want two of them.
 */
export function useSessions(filters: SessionListFilters = {}) {
  return useQuery({ queryKey: sessionKeys.list(filters), queryFn: () => fetchSessions(filters) });
}

/** Not capped by role — see the module comment. A stale or invented id is a plain `404`. */
export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => unwrap(api.GET('/api/v1/sessions/{id}', { params: { path: { id } } })),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSessionInput): Promise<Session> =>
      unwrap(api.POST('/api/v1/sessions', { body: input })),
    onSuccess: (created) => {
      queryClient.setQueryData(sessionKeys.detail(created.id), created);
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export function useAmendSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AmendSessionInput }): Promise<Session> =>
      unwrap(api.PATCH('/api/v1/sessions/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: (updated) => {
      queryClient.setQueryData(sessionKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }): Promise<Session> =>
      unwrap(
        api.POST('/api/v1/sessions/{id}/cancel', {
          params: { path: { id } },
          // An empty reason is dropped rather than sent as `''`: the field is
          // optional, and an admin who left it blank should not have a blank
          // sentence saved onto `cancelledReason` for ever.
          body: reason === '' ? {} : { reason },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(sessionKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export type SessionMaterialisationReport =
  paths['/api/v1/jobs/session-materialisation/run']['post']['responses']['200']['content']['application/json'];

/**
 * Runs the nightly job now — the only way a template turns into sessions.
 *
 * **A weekly template generates nothing by itself.** It is the cron that
 * materialises six weeks of sessions from every template, so without this an
 * admin adds a weekly session, sees the sessions list unchanged, and has no way
 * to tell the difference between "it worked and runs overnight" and "it did not
 * work". Idempotent by the server's own description, so a second click creates
 * nothing and a double click is harmless — which is why the control may use a
 * plain `disabled` rather than the synchronous-ref guard the shop needs.
 *
 * It invalidates the session **lists** only. The job does not touch the
 * templates, and it is careful not to reach for `sessionKeys.all`: a detail
 * screen's cache entry is for a session that already existed and is unaffected
 * by new ones appearing.
 *
 * The job also clears expired referral edit keys and, where a retention period
 * is configured, purges old personal data. That is the server's business and
 * nothing here depends on it, but it is why this is worded as running the
 * scheduled jobs rather than as a sessions-only button.
 */
export function useRunSessionMaterialisation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<SessionMaterialisationReport> =>
      unwrap(api.POST('/api/v1/jobs/session-materialisation/run')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

async function fetchRecurringSessions(): Promise<RecurringSession[]> {
  const { recurringSessions } = await unwrap(api.GET('/api/v1/recurring-sessions'));
  return sortRecurringSessions(recurringSessions);
}

export function useRecurringSessions() {
  return useQuery({ queryKey: sessionKeys.recurring(), queryFn: fetchRecurringSessions });
}

/** A projection over the one list query — see the module comment for why there is no single-item `GET`. */
export function useRecurringSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.recurring(),
    queryFn: fetchRecurringSessions,
    select: (rows: RecurringSession[]) => rows.find((row) => row.id === id) ?? null,
  });
}

export function useCreateRecurringSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRecurringSessionInput): Promise<RecurringSession> =>
      unwrap(api.POST('/api/v1/recurring-sessions', { body: input })),
    onSuccess: (created) => {
      spliceIntoRecurringList(queryClient, created);
    },
  });
}

export function useAmendRecurringSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: RecurringSessionPatch;
    }): Promise<RecurringSession> =>
      unwrap(
        api.PATCH('/api/v1/recurring-sessions/{id}', {
          params: { path: { id } },
          body: patch,
        }),
      ),
    onSuccess: (updated) => {
      spliceIntoRecurringList(queryClient, updated);
    },
  });
}

/**
 * Both recurring-session mutations answer with the bare row, so it is spliced
 * into the cached list rather than waited on: a template just created must
 * appear immediately for `useRecurringSession` to find, since the amend screen
 * a create redirects to has nothing else to read it from.
 */
function spliceIntoRecurringList(queryClient: QueryClient, row: RecurringSession): void {
  queryClient.setQueryData<RecurringSession[]>(sessionKeys.recurring(), (current) =>
    current === undefined
      ? undefined
      : sortRecurringSessions([...current.filter((existing) => existing.id !== row.id), row]),
  );
  void queryClient.invalidateQueries({ queryKey: sessionKeys.recurring() });
}
