import type { SmsReminderResult } from './queries';

export function formatSmsReminderOutcome({
  reminded,
  simulated,
  failed,
  alreadyReminded,
}: SmsReminderResult): string {
  const sent = `${String(reminded)} ${reminded === 1 ? 'message' : 'messages'} sent`;
  const simulation = simulated === 0 ? '' : ` — ${String(simulated)} simulated`;
  return `${sent}${simulation}; ${String(failed)} failed; ${String(alreadyReminded)} already sent.`;
}

export function formatSmsReplyOutcome(simulated: boolean): string {
  return simulated ? 'Message simulated.' : 'Message sent.';
}
