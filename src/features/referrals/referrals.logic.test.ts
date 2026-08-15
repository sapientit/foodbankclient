import { describe, expect, it } from 'vitest';
import type { Referral } from './queries';
import {
  cameFromSearch,
  describeHousehold,
  describeLockedReferral,
  hasAdminFields,
  isPurged,
  isReferralStatus,
  moveCapacityWarning,
  normalisePhone,
  parseWholeNumber,
  refereeName,
  refereeNameForList,
  sortForReview,
  sortReferrals,
  wouldExceedCapacity,
} from './referrals.logic';

function referral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 1,
    children: 0,
    householdSize: 1,
    isDelivery: false,
    needsFuelHelp: false,
    referrerOrganisation: 'Riverside Church',
    referrerName: 'Sam Referrer',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'AB1 2CD',
    refereePhone: null,
    answers: {},
    piiPurgedAt: null,
    ...overrides,
  };
}

describe('isReferralStatus', () => {
  it('accepts the two real statuses and rejects anything else', () => {
    expect(isReferralStatus('active')).toBe(true);
    expect(isReferralStatus('cancelled')).toBe(true);
    expect(isReferralStatus('pending')).toBe(false);
    expect(isReferralStatus(null)).toBe(false);
  });
});

describe('sortReferrals', () => {
  it('orders most recently referred first', () => {
    const older = referral({ id: 'r1', referredAt: '2026-07-01T09:00:00.000Z' });
    const newer = referral({ id: 'r2', referredAt: '2026-07-02T09:00:00.000Z' });

    expect(sortReferrals([older, newer]).map((row) => row.id)).toEqual(['r2', 'r1']);
  });

  it('sorts an unparseable referredAt to the end rather than throwing', () => {
    const good = referral({ id: 'r1', referredAt: '2026-07-01T09:00:00.000Z' });
    const bad = referral({ id: 'r2', referredAt: 'not-a-date' });

    expect(sortReferrals([bad, good]).map((row) => row.id)).toEqual(['r1', 'r2']);
  });
});

describe('describeHousehold', () => {
  it('uses singular nouns for exactly one adult and one child', () => {
    expect(describeHousehold({ adults: 1, children: 1 })).toBe('1 adult, 1 child');
  });

  it('uses plural nouns otherwise, including zero children', () => {
    expect(describeHousehold({ adults: 2, children: 0 })).toBe('2 adults, 0 children');
    expect(describeHousehold({ adults: 5, children: 3 })).toBe('5 adults, 3 children');
  });
});

describe('hasAdminFields', () => {
  it('is true when reasonId is present, even if the value is falsy-shaped', () => {
    const row = referral({
      id: 'r1',
      reasonId: 'reason-1',
      referrerEmail: null,
      referrerPhone: null,
    });
    expect(hasAdminFields(row)).toBe(true);
  });

  it('is false when the key is genuinely absent — the team lead shape', () => {
    const row = referral({ id: 'r1' });
    expect(hasAdminFields(row)).toBe(false);
    expect('reasonId' in row).toBe(false);
  });
});

describe('isPurged', () => {
  it('is true only once piiPurgedAt is set', () => {
    expect(isPurged(referral({ id: 'r1' }))).toBe(false);
    expect(isPurged(referral({ id: 'r1', piiPurgedAt: '2026-08-01T00:00:00.000Z' }))).toBe(true);
  });
});

describe('describeLockedReferral', () => {
  it('is null for an active referral', () => {
    expect(describeLockedReferral({ status: 'active' })).toBeNull();
  });

  it('names the reason for a rejected one, which is equally final', () => {
    expect(describeLockedReferral({ status: 'rejected' })).toMatch(/rejected/);
  });

  it('is null for one awaiting review — it can still be amended', () => {
    expect(describeLockedReferral({ status: 'pending_review' })).toBeNull();
  });

  it('names the reason for a cancelled one', () => {
    expect(describeLockedReferral({ status: 'cancelled' })).toContain('cancelled');
  });
});

describe('cameFromSearch', () => {
  it('is true only for the flag a search result link sets', () => {
    expect(cameFromSearch({ fromSearch: true })).toBe(true);
  });

  it('reads anything else out of the browser’s history as no', () => {
    // Router state is whatever the history entry holds — a restored session, a
    // hand-edited entry, something a previous version of this app wrote.
    expect(cameFromSearch(null)).toBe(false);
    expect(cameFromSearch(undefined)).toBe(false);
    expect(cameFromSearch({})).toBe(false);
    expect(cameFromSearch({ fromSearch: 'yes' })).toBe(false);
    expect(cameFromSearch('fromSearch')).toBe(false);
    expect(cameFromSearch(['fromSearch'])).toBe(false);
  });
});

describe('refereeName / refereeNameForList', () => {
  it('joins the two halves for a heading and reverses them for a list', () => {
    // The surname is held apart precisely because it is what a list sorts by
    // and what a volunteer matches a bag to.
    expect(refereeName(referral({ id: 'r1' }))).toBe('Jamie Rowe');
    expect(refereeNameForList(referral({ id: 'r1' }))).toBe('Rowe, Jamie');
  });

  it('is null for a purged referral rather than a stray space or the word null', () => {
    const purged = referral({ id: 'r1', refereeFirstName: null, refereeSurname: null });
    expect(refereeName(purged)).toBeNull();
    expect(refereeNameForList(purged)).toBeNull();
  });

  it('copes with only one half present', () => {
    expect(refereeName(referral({ id: 'r1', refereeFirstName: null }))).toBe('Rowe');
    expect(refereeNameForList(referral({ id: 'r1', refereeSurname: null }))).toBe('Jamie');
  });
});

describe('sortForReview', () => {
  it('puts referrals awaiting review first, each group newest first', () => {
    // A household waiting on a decision is more urgent than one already booked
    // in, and a queue nobody sees is a queue nobody works.
    const list = [
      referral({ id: 'old-active', status: 'active', referredAt: '2026-07-01T09:00:00.000Z' }),
      referral({
        id: 'old-pending',
        status: 'pending_review',
        referredAt: '2026-06-01T09:00:00.000Z',
      }),
      referral({ id: 'new-active', status: 'active', referredAt: '2026-07-05T09:00:00.000Z' }),
      referral({
        id: 'new-pending',
        status: 'pending_review',
        referredAt: '2026-07-04T09:00:00.000Z',
      }),
    ];

    expect(sortForReview(list).map((r) => r.id)).toEqual([
      'new-pending',
      'old-pending',
      'new-active',
      'old-active',
    ]);
  });
});

describe('wouldExceedCapacity / moveCapacityWarning', () => {
  it('is false, and warns nothing, well under capacity', () => {
    expect(wouldExceedCapacity({ booked: 10, capacity: 25 })).toBe(false);
    expect(moveCapacityWarning({ booked: 10, capacity: 25 })).toBeNull();
  });

  it('is true at exactly capacity — one more referral takes it over', () => {
    expect(wouldExceedCapacity({ booked: 25, capacity: 25 })).toBe(true);
  });

  it('warns with both numbers when already full or over', () => {
    const warning = moveCapacityWarning({ booked: 25, capacity: 25 });
    expect(warning).toContain('25');
    expect(warning).toContain('places booked');
  });
});

describe('normalisePhone', () => {
  it('turns a blank or whitespace-only field into null', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
  });

  it('trims a real number', () => {
    expect(normalisePhone('  01234 567890  ')).toBe('01234 567890');
  });
});

describe('parseWholeNumber', () => {
  const bounds = { minimum: 1, maximum: 30 };

  it('accepts a whole number in range', () => {
    expect(parseWholeNumber('4', bounds)).toEqual({ ok: true, value: 4 });
  });

  it('rejects empty, fractional and out-of-range input', () => {
    expect(parseWholeNumber('', bounds)).toEqual({ ok: false, problem: 'empty' });
    expect(parseWholeNumber('2.5', bounds)).toEqual({ ok: false, problem: 'not-a-whole-number' });
    expect(parseWholeNumber('0', bounds)).toEqual({ ok: false, problem: 'below-minimum' });
    expect(parseWholeNumber('31', bounds)).toEqual({ ok: false, problem: 'above-maximum' });
  });

  it('allows zero when the bounds say so — children has no lower floor', () => {
    expect(parseWholeNumber('0', { minimum: 0, maximum: 30 })).toEqual({ ok: true, value: 0 });
  });
});
