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

export function useSmsSummary(sessionId: string) {
  return useQuery({
    queryKey: pickListKeys.smsSummary(sessionId),
    enabled: sessionId !== '',
    queryFn: (): Promise<SmsSummary> =>
      unwrap(
        api.GET('/api/v1/sessions/{sessionId}/sms-summary', { params: { path: { sessionId } } }),
      ),
    // The SMS contract explicitly makes this the sole polling target while the
    // run-session screen is open; all other queries keep the global no-poll rule.
    refetchInterval: 5_000,
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
    mutationFn: (sessionId: string): Promise<Reconciliation> =>
      unwrap(
        api.POST('/api/v1/sessions/{sessionId}/pick-list', {
          params: { path: { sessionId } },
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
    }: {
      parcelId: string;
      lines: readonly { stockItemId: string; quantity: number }[];
    }) => {
      await Promise.all(
        lines.map((line) =>
          unwrapVoid(
            api.PUT('/api/v1/parcels/{id}/lines', {
              params: { path: { id: parcelId } },
              body: line,
            }),
          ),
        ),
      );
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
