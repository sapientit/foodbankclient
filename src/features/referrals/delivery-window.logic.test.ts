import { describe, expect, it } from 'vitest';
import { referralFormDefinition } from './referral-form-config';
import {
  DELIVERY_TIME_LABEL,
  DELIVERY_TIME_VARIABLE,
  applyFormVariables,
  deliveryWindowConfirmation,
  describeDeliveryWindow,
  refusedForDeliveryPlaces,
  type DeliverySession,
} from './delivery-window.logic';

function session(overrides: Partial<DeliverySession> = {}): DeliverySession {
  return {
    sessionDate: '2026-08-04',
    deliveryWindowStart: '13:00',
    deliveryWindowEnd: '15:00',
    deliveryAvailability: 'available',
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
    expect(describeDeliveryWindow(session({ deliveryAvailability: 'not_offered' }))).toBe(
      'No deliveries available for this session',
    );
  });

  it('says separately that a session delivers but has no places left', () => {
    // The other of the two refusals, and a different fact about the session:
    // this one has drivers, and a referrer reading it may find room on the
    // next session rather than none at all.
    expect(describeDeliveryWindow(session({ deliveryAvailability: 'full' }))).toBe(
      'No delivery slots available for this session',
    );
  });

  it('tells the two refusals apart rather than collapsing them into one sentence', () => {
    // They are near enough the same words on purpose — Pete, 2026-08-19 — but
    // they are not the same sentence, and a change that made them identical
    // would lose the distinction silently.
    expect(describeDeliveryWindow(session({ deliveryAvailability: 'not_offered' }))).not.toBe(
      describeDeliveryWindow(session({ deliveryAvailability: 'full' })),
    );
  });

  it('ignores the stored window entirely when a delivery cannot be had', () => {
    for (const availability of ['not_offered', 'full'] as const) {
      const answer = describeDeliveryWindow(
        session({
          deliveryAvailability: availability,
          deliveryWindowStart: '09:00',
          deliveryWindowEnd: '11:00',
        }),
      );
      expect(answer).not.toMatch(/09:00|11:00/);
    }
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

describe('refusedForDeliveryPlaces', () => {
  it('reads the delivery refusal from its structural key', () => {
    expect(refusedForDeliveryPlaces({ deliveryCapacity: 8, booked: 8 })).toBe(true);
  });

  it('does not mistake the capacity refusal for it', () => {
    // The other `409` that carries `details`, and the one whose window is
    // untouched — a full session delivers on exactly the hours it always did.
    expect(refusedForDeliveryPlaces({ capacity: 25, booked: 25 })).toBe(false);
  });

  it('reads the three refusals that carry nothing as not it', () => {
    // Cancelled, already confirmed, and past the cutoff send no `details` at
    // all. Failing closed is right: the cost of missing one is a tick that
    // stands, the cost of guessing is a referrer re-answering for nothing.
    expect(refusedForDeliveryPlaces(null)).toBe(false);
    expect(refusedForDeliveryPlaces({})).toBe(false);
  });

  it('never reads the message, which the food bank may reword', () => {
    // The sentence for this very refusal, in the details bag where it does not
    // belong. Matching on wording is the failure this function exists to avoid.
    expect(refusedForDeliveryPlaces({ message: 'Delivery places for that session are full' })).toBe(
      false,
    );
  });
});

describe('deliveryWindowConfirmation', () => {
  it('finds the confirmation and the answer about the window in the real config', () => {
    const found = deliveryWindowConfirmation(referralFormDefinition);
    expect(found).not.toBeNull();
    expect(found?.value).toContain('at home');
  });

  it('picks the second answer, never the first', () => {
    /*
     * The first confirmation is a fact about the household — that they meet the
     * criteria for delivery — and is true whichever session they are on. Only
     * the second is about the session's window, and only the second may be
     * taken away. This is the assertion that stops a later change resetting
     * both and making a referrer re-answer something that was never wrong.
     */
    const found = deliveryWindowConfirmation(referralFormDefinition);
    expect(found?.value).not.toContain('criteria');
  });

  it('answers null for a form that asks for no such confirmation', () => {
    // The questionnaire is the charity's. A form with no delivery line has
    // nothing to reset, and that is an ordinary state rather than a fault.
    expect(deliveryWindowConfirmation({ version: 1, pages: [] })).toBeNull();
  });
});
