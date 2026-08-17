import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap, unwrapVoid } from '../../api/unwrap';
import { sessionKeys } from '../sessions/keys';
import { pickListKeys } from './keys';

export type PickList = components['schemas']['PickList'];
export type Parcel = components['schemas']['Parcel'];
export type SessionPickList =
  paths['/api/v1/sessions/{sessionId}/pick-list']['get']['responses'][200]['content']['application/json'];
export type Reconciliation =
  paths['/api/v1/sessions/{sessionId}/pick-list']['post']['responses'][200]['content']['application/json'];
export type PrintPickList =
  paths['/api/v1/pick-lists/{id}/print']['get']['responses'][200]['content']['application/json'];
export type ListenerSheet =
  paths['/api/v1/sessions/{sessionId}/listener-sheet']['get']['responses'][200]['content']['application/json'];
export type SmsSummary =
  paths['/api/v1/sessions/{sessionId}/sms-summary']['get']['responses'][200]['content']['application/json'];
export type SmsThread =
  paths['/api/v1/referrals/{id}/sms-messages']['get']['responses'][200]['content']['application/json'];
export type SmsMessage = components['schemas']['SmsMessage'];
export type StockRequirement =
  paths['/api/v1/sessions/{sessionId}/stock-requirement']['get']['responses'][200]['content']['application/json'];
export type StockRequirementLine = components['schemas']['StockRequirementLine'];
export type SessionReferralDetails = components['schemas']['SessionReferralDetails'];

export function useSessionReferralDetails(sessionId: string) {
  return useQuery({
    queryKey: [...pickListKeys.session(sessionId), 'referral-details'] as const,
    enabled: sessionId !== '',
    queryFn: (): Promise<SessionReferralDetails> =>
      unwrap(
        api.GET('/api/v1/sessions/{sessionId}/referral-details', {
          params: { path: { sessionId } },
        }),
      ),
  });
}
type PreferenceLines = NonNullable<
  NonNullable<
    paths['/api/v1/sessions/{sessionId}/pick-list']['post']['requestBody']
  >['content']['application/json']['preferenceLines']
>;
type PickListInformationEntries = NonNullable<
  NonNullable<
    paths['/api/v1/sessions/{sessionId}/pick-list']['post']['requestBody']
  >['content']['application/json']['pickListInformation']
>;

function fetchSessionPickList(sessionId: string): Promise<SessionPickList> {
  return unwrap(
    api.GET('/api/v1/sessions/{sessionId}/pick-list', {
      params: { path: { sessionId } },
    }),
  );
}

export function useSessionPickList(sessionId: string) {
  return useQuery({
    queryKey: pickListKeys.session(sessionId),
    enabled: sessionId !== '',
    queryFn: () => fetchSessionPickList(sessionId),
  });
}

/**
 * What the session asks for off the shelves, against what is on them.
 *
 * **Asked for, never fetched with the screen.** It is one line per stock item
 * the session's parcels between them call for, and a team lead wants it once,
 * when they are about to go and look — so it is read when the panel is opened
 * rather than on every visit to a session.
 *
 * **No `staleTime`**, against the client's minute everywhere else. Both halves
 * of the comparison move under it: a parcel's quantity is edited on this very
 * screen, and `quantityOnHand` changes with a stock take, an adjustment or an
 * attendance outcome recorded on another volunteer's phone. Somebody acts on
 * this figure by walking to a shelf, so closing the panel and opening it again
 * has to ask again rather than repeat the answer from when the session opened.
 *
 * Shelf order is the server's default and is left alone: the reason to read
 * this is to walk the warehouse once.
 */
export function useSessionStockRequirement(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: pickListKeys.stockRequirement(sessionId),
    enabled: enabled && sessionId !== '',
    staleTime: 0,
    queryFn: (): Promise<StockRequirement> =>
      unwrap(
        api.GET('/api/v1/sessions/{sessionId}/stock-requirement', {
          params: { path: { sessionId } },
        }),
      ),
  });
}

/**
 * The sole role-scoped response that gives a team lead the referral reason.
 * It belongs to the listener sheet only: do not reuse it for referrals or pick
 * lists, where the reason remains deliberately absent.
 */
export function useListenerSheet(sessionId: string) {
  return useQuery({
    queryKey: pickListKeys.listener(sessionId),
    enabled: sessionId !== '',
    queryFn: (): Promise<ListenerSheet> =>
      unwrap(
        api.GET('/api/v1/sessions/{sessionId}/listener-sheet', {
          params: { path: { sessionId } },
        }),
      ),
  });
}

/**
 * `poll` is the session still being run.
 *
 * The SMS contract explicitly makes this the sole polling target while the
 * run-session screen is open; all other queries keep the global no-poll rule.
 * **That exception is for a session in progress and does not survive it** — on a
 * finished session the unread count cannot change, so polling it would be a
 * request every five seconds, on a hall's wifi, for an answer already known.
 */
export function useSmsSummary(sessionId: string, poll: boolean) {
  return useQuery({
    queryKey: pickListKeys.smsSummary(sessionId),
    enabled: sessionId !== '',
    queryFn: (): Promise<SmsSummary> =>
      unwrap(
        api.GET('/api/v1/sessions/{sessionId}/sms-summary', { params: { path: { sessionId } } }),
      ),
    refetchInterval: poll ? 5_000 : false,
  });
}

export function useSmsThread(referralId: string, enabled: boolean) {
  return useQuery({
    queryKey: pickListKeys.smsThread(referralId),
    enabled: enabled && referralId !== '',
    queryFn: (): Promise<SmsThread> =>
      unwrap(
        api.GET('/api/v1/referrals/{id}/sms-messages', { params: { path: { id: referralId } } }),
      ),
  });
}

export function useSendSmsReminders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      unwrap(
        api.POST('/api/v1/sessions/{sessionId}/sms-reminders', { params: { path: { sessionId } } }),
      ),
    onSuccess: (_, sessionId) => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.smsSummary(sessionId) });
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

export function useMarkSmsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (referralId: string) =>
      unwrap(
        api.POST('/api/v1/referrals/{id}/sms-messages/read', {
          params: { path: { id: referralId } },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: pickListKeys.all }),
  });
}

export function useReplyBySms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ referralId, body }: { referralId: string; body: string }): Promise<SmsMessage> =>
      unwrap(
        api.POST('/api/v1/referrals/{id}/sms-messages', {
          params: { path: { id: referralId } },
          body: { body },
        }),
      ),
    onSuccess: (_, { referralId }) => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.smsThread(referralId) });
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

export function useUnmatchedSms() {
  return useQuery({
    queryKey: pickListKeys.unmatchedSms(),
    queryFn: () => unwrap(api.GET('/api/v1/sms-messages/unmatched')),
  });
}

export function useMarkUnmatchedSmsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<SmsMessage> =>
      unwrap(api.POST('/api/v1/sms-messages/{id}/read', { params: { path: { id } } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: pickListKeys.unmatchedSms() }),
  });
}

/** POST is deliberately the entry action: it creates any late, uncovered parcels. */
export function useReconcilePickList(onPickListReady?: (sessionId: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      preferenceLines,
      pickListInformation,
    }: {
      sessionId: string;
      preferenceLines: PreferenceLines;
      pickListInformation: PickListInformationEntries;
    }): Promise<Reconciliation> =>
      unwrap(
        api.POST('/api/v1/sessions/{sessionId}/pick-list', {
          params: { path: { sessionId } },
          body: {
            preferenceLines,
            ...(pickListInformation.length === 0 ? {} : { pickListInformation }),
          },
        }),
      ),
    onSuccess: async (result) => {
      // This is part of opening a runnable session, not a best-effort cache
      // refresh. Do the read here so a successful POST is always followed by
      // the GET that supplies the client workspace.
      onPickListReady?.(result.sessionId);
      await queryClient.fetchQuery({
        queryKey: pickListKeys.session(result.sessionId),
        queryFn: () => fetchSessionPickList(result.sessionId),
      });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(result.sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export function useRecordAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attendance }: { id: string; attendance: 'attended' | 'no_show' }) =>
      unwrap(
        api.POST('/api/v1/parcels/{id}/attendance', {
          params: { path: { id } },
          body: { attendance },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useReviewParcel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (parcelId: string) =>
      unwrap(api.POST('/api/v1/parcels/{id}/review', { params: { path: { id: parcelId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

export function useSetParcelLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      parcelId,
      stockItemId,
      quantity,
    }: {
      parcelId: string;
      stockItemId: string;
      quantity: number;
    }) =>
      unwrap(
        api.PUT('/api/v1/parcels/{id}/lines', {
          params: { path: { id: parcelId } },
          body: { stockItemId, quantity },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

/**
 * The picker edits a whole parcel locally, then saves once. The server's
 * current line endpoint is deliberately idempotent, so sending only the
 * changed lines makes retrying a failed save safe.
 */
export function useSetParcelLines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      parcelId,
      lines,
      notes,
    }: {
      parcelId: string;
      lines: readonly { stockItemId: string; quantity: number }[];
      notes?: string | null;
    }) => {
      await Promise.all([
        ...lines.map((line) =>
          unwrapVoid(
            api.PUT('/api/v1/parcels/{id}/lines', {
              params: { path: { id: parcelId } },
              body: line,
            }),
          ),
        ),
        ...(notes === undefined
          ? []
          : [
              unwrap(
                api.PATCH('/api/v1/parcels/{id}', {
                  params: { path: { id: parcelId } },
                  body: { notes },
                }),
              ),
            ]),
      ]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

export function usePrintPickList(pickListId: string) {
  return useQuery({
    queryKey: pickListKeys.print(pickListId),
    enabled: pickListId !== '',
    queryFn: (): Promise<PrintPickList> =>
      unwrap(api.GET('/api/v1/pick-lists/{id}/print', { params: { path: { id: pickListId } } })),
  });
}

export function useMarkPickListPrinted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pickListId: string): Promise<PickList> =>
      unwrap(api.POST('/api/v1/pick-lists/{id}/print', { params: { path: { id: pickListId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
    },
  });
}

export function useConfirmSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      unwrap(
        api.POST('/api/v1/sessions/{sessionId}/confirm', {
          params: { path: { sessionId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pickListKeys.all });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}
