import { describe, expect, it } from 'vitest';
import {
  COLLECTION_ONLY,
  NO_DELIVERIES,
  deliveryLabel,
  describeSessionChoice,
  standingFromCapacity,
} from './session-description';

describe('deliveryLabel', () => {
  it('names a session with nobody to drive', () => {
    expect(deliveryLabel('none')).toBe(COLLECTION_ONLY);
  });

  it('names a session whose delivery places have gone, and not with the same words', () => {
    // Two different facts about a session, and the second is the one that can
    // change by tomorrow. Collapsing them would tell a referrer the food bank
    // has no drivers when it has a full round.
    expect(deliveryLabel('full')).toBe(NO_DELIVERIES);
    expect(NO_DELIVERIES).not.toBe(COLLECTION_ONLY);
  });

  it('says nothing at all about a session that can still deliver', () => {
    // `null` rather than `''`, so a caller has to decide what an absent label
    // renders as: a dropdown leaves it out of the sentence, a table leaves the
    // cell empty so the columns still line up. Collection is the ordinary case
    // and saying so on every row is the noise the location used to be.
    expect(deliveryLabel('open')).toBeNull();
  });
});

describe('standingFromCapacity', () => {
  it('reads nought as nobody driving', () => {
    expect(standingFromCapacity(0)).toBe('none');
  });

  it('reads any figure at all as delivering, one included', () => {
    expect(standingFromCapacity(1)).toBe('open');
    expect(standingFromCapacity(8)).toBe('open');
  });

  it('never reports a staff session as full, however many places it has', () => {
    /*
     * Not an oversight — a limit of the contract, and the reason the staff
     * table cannot say `No deliveries`. `Session` carries the delivery capacity
     * an administrator set but **no count of the deliveries booked against
     * it**, so nothing here can tell a session whose places have gone from one
     * with places left. Anyone making this return `'full'` is guessing from
     * data that is not there.
     */
    for (const capacity of [0, 1, 8, 25]) {
      expect(standingFromCapacity(capacity)).not.toBe('full');
    }
  });
});

describe('describeSessionChoice', () => {
  it('adds the label after the time, so the line reads as one thing', () => {
    expect(describeSessionChoice('Tue, 4 Aug 2026 at 10:00', 'none')).toBe(
      'Tue, 4 Aug 2026 at 10:00, Collection Only',
    );
    expect(describeSessionChoice('Tue, 4 Aug 2026 at 10:00', 'full')).toBe(
      'Tue, 4 Aug 2026 at 10:00, No deliveries',
    );
  });

  it('leaves an ordinary session as the time alone, with no trailing comma', () => {
    expect(describeSessionChoice('Tue, 4 Aug 2026 at 10:00', 'open')).toBe(
      'Tue, 4 Aug 2026 at 10:00',
    );
  });

  it('never names the location, which the caller has already left out', () => {
    // One hall, so it said the same words on every row and pushed the parts
    // that do differ off the edge of a phone. The caller formats the `when`,
    // because the public form shows a start time and never an end one.
    expect(describeSessionChoice('Tue, 4 Aug 2026 at 10:00', 'none')).not.toContain('Hall');
  });
});
