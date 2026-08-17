import { describe, expect, it } from 'vitest';
import {
  DELIVERY_TIME_LABEL,
  DELIVERY_TIME_VARIABLE,
  applyFormVariables,
  describeDeliveryWindow,
  type DeliverySession,
} from './delivery-window.logic';

function session(overrides: Partial<DeliverySession> = {}): DeliverySession {
  return {
    sessionDate: '2026-08-04',
    deliveryWindowStart: '13:00',
    deliveryWindowEnd: '15:00',
    deliveriesAllowed: true,
    ...overrides,
  };
}

describe('describeDeliveryWindow', () => {
  it('states the window and the day, so a referrer can ask the household about a real time', () => {
    expect(describeDeliveryWindow(session())).toBe('between 13:00 and 15:00 on Tue, 4 Aug 2026');
  });

  it('says plainly that a session takes no deliveries', () => {
    // Never a window for a session with nobody to drive: quoting one is a
    // promise the round cannot keep.
    expect(describeDeliveryWindow(session({ deliveriesAllowed: false }))).toBe(
      'No deliveries available for this session',
    );
  });

  it('ignores the stored window entirely when nobody is driving', () => {
    const answer = describeDeliveryWindow(
      session({
        deliveriesAllowed: false,
        deliveryWindowStart: '09:00',
        deliveryWindowEnd: '11:00',
      }),
    );
    expect(answer).not.toMatch(/09:00|11:00/);
  });

  it('needs no fallback, because the public session carries the resolved window', () => {
    // A session setting none of its own reports its own hours from the server,
    // so both ends are always present here and this client never re-derives it.
    expect(
      describeDeliveryWindow(session({ deliveryWindowStart: '10:00', deliveryWindowEnd: '12:00' })),
    ).toContain('between 10:00 and 12:00');
  });
});

describe('applyFormVariables', () => {
  it('leaves text with no variable in it exactly as the charity wrote it', () => {
    // Which is every other question on the form.
    expect(applyFormVariables('How will the parcel be collected', {})).toEqual([
      { text: 'How will the parcel be collected', emphasis: false },
    ]);
  });

  it('announces the delivery time under a label that stands out from the window', () => {
    // The label carries the emphasis and the window does not: a line a referrer
    // can find, in text they can read, which the plain sentence was not.
    expect(applyFormVariables(DELIVERY_TIME_VARIABLE, { deliveryTime: 'at noon' })).toEqual([
      { text: DELIVERY_TIME_LABEL, emphasis: true },
      { text: ' at noon', emphasis: false },
    ]);
  });

  it('substitutes a variable embedded in a longer sentence', () => {
    expect(
      applyFormVariables(`Note: ${DELIVERY_TIME_VARIABLE}.`, { deliveryTime: 'noon' }),
    ).toEqual([
      { text: 'Note: ', emphasis: false },
      { text: DELIVERY_TIME_LABEL, emphasis: true },
      { text: ' noon', emphasis: false },
      { text: '.', emphasis: false },
    ]);
  });

  /**
   * The failure this prevents: a referrer reading the literal `$deliveryTime`
   * learns the form is broken. `null` means render nothing at all, and the
   * question field returns no row for it.
   */
  it('returns null rather than printing the token when nothing has resolved it', () => {
    expect(applyFormVariables(DELIVERY_TIME_VARIABLE, {})).toBeNull();
    expect(applyFormVariables(DELIVERY_TIME_VARIABLE, { deliveryTime: null })).toBeNull();
  });

  it('never leaves a token behind when the same variable appears twice', () => {
    const answer = applyFormVariables(`${DELIVERY_TIME_VARIABLE} — ${DELIVERY_TIME_VARIABLE}`, {
      deliveryTime: 'noon',
    });
    expect(answer?.map((segment) => segment.text).join('')).toBe(
      `${DELIVERY_TIME_LABEL} noon — ${DELIVERY_TIME_LABEL} noon`,
    );
    expect(answer?.map((segment) => segment.text).join('')).not.toContain(DELIVERY_TIME_VARIABLE);
  });
});
