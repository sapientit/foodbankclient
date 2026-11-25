import { describe, expect, it } from 'vitest';
import { isDeliveryAnswer, isReferrerCollectAnswer } from './collection-method.logic';

describe('isDeliveryAnswer', () => {
  it('is true only for Delivery Requested', () => {
    expect(isDeliveryAnswer({ answers: { 'Collection method': 'Delivery Requested' } })).toBe(true);
  });

  it.each(['Car', 'Public Transport', 'On Foot', 'Referrer will collect'])(
    'is false for %s',
    (answer) => {
      expect(isDeliveryAnswer({ answers: { 'Collection method': answer } })).toBe(false);
    },
  );

  it('is false when there is no answer', () => {
    expect(isDeliveryAnswer({ answers: {} })).toBe(false);
  });
});

describe('isReferrerCollectAnswer', () => {
  it('is true only for Referrer will collect', () => {
    expect(
      isReferrerCollectAnswer({ answers: { 'Collection method': 'Referrer will collect' } }),
    ).toBe(true);
  });

  it.each(['Car', 'Public Transport', 'On Foot', 'Delivery Requested'])(
    'is false for %s',
    (answer) => {
      expect(isReferrerCollectAnswer({ answers: { 'Collection method': answer } })).toBe(false);
    },
  );

  it('is false when there is no answer', () => {
    expect(isReferrerCollectAnswer({ answers: {} })).toBe(false);
  });
});
