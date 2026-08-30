import { describe, expect, it } from 'vitest';
import { formatSmsReminderOutcome, formatSmsReplyOutcome } from './sms-outcomes';

describe('SMS outcomes', () => {
  it('states how many reminder sends were simulated without treating them as a separate outcome', () => {
    expect(
      formatSmsReminderOutcome({ reminded: 12, simulated: 9, failed: 1, alreadyReminded: 3 }),
    ).toBe('12 messages sent — 9 simulated; 1 failed; 3 already sent.');
  });

  it('does not imply simulation when every reminder really went', () => {
    expect(
      formatSmsReminderOutcome({ reminded: 1, simulated: 0, failed: 0, alreadyReminded: 0 }),
    ).toBe('1 message sent; 0 failed; 0 already sent.');
  });

  it('distinguishes an individual real reply from a simulated one', () => {
    expect(formatSmsReplyOutcome(false)).toBe('Message sent.');
    expect(formatSmsReplyOutcome(true)).toBe('Message simulated.');
  });
});
