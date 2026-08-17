/** Query keys for the operational session workflow. */
export const pickListKeys = {
  all: ['pick-lists'] as const,
  session: (sessionId: string) => [...pickListKeys.all, 'session', sessionId] as const,
  print: (pickListId: string) => [...pickListKeys.all, 'print', pickListId] as const,
  listener: (sessionId: string) => [...pickListKeys.all, 'listener', sessionId] as const,
  /**
   * Under this root deliberately: the requirement is the session's parcel lines
   * added up, so every mutation that already invalidates `pickListKeys.all` —
   * a saved quantity, a review, an attendance outcome — has to move this figure
   * too. A key of its own outside the root is a stock check still quoting the
   * quantity somebody has just changed.
   */
  stockRequirement: (sessionId: string) =>
    [...pickListKeys.all, 'stock-requirement', sessionId] as const,
  smsSummary: (sessionId: string) => [...pickListKeys.all, 'sms-summary', sessionId] as const,
  smsThread: (referralId: string) => [...pickListKeys.all, 'sms-thread', referralId] as const,
  unmatchedSms: () => [...pickListKeys.all, 'unmatched-sms'] as const,
};
