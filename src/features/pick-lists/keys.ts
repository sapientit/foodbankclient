/** Query keys for the operational session workflow. */
export const pickListKeys = {
  all: ['pick-lists'] as const,
  session: (sessionId: string) => [...pickListKeys.all, 'session', sessionId] as const,
  print: (pickListId: string) => [...pickListKeys.all, 'print', pickListId] as const,
  listener: (sessionId: string) => [...pickListKeys.all, 'listener', sessionId] as const,
  smsSummary: (sessionId: string) => [...pickListKeys.all, 'sms-summary', sessionId] as const,
  smsThread: (referralId: string) => [...pickListKeys.all, 'sms-thread', referralId] as const,
  unmatchedSms: () => [...pickListKeys.all, 'unmatched-sms'] as const,
};
