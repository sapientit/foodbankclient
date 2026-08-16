import { describe, expect, it } from 'vitest';
import type { Referral } from './queries';
import {
  REFERRAL_STATUS_LABELS,
  cameFromCopy,
  cameFromSearch,
  canCopyReferral,
  copyCapacityWarning,
  describeHousehold,
  describeLockedReferral,
  describeSettledReferral,
  displayedOutcome,
  hasAdminFields,
  isPurged,
  isReferralStatus,
  moveCapacityWarning,
  needsReferrerApproval,
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

describe('describeSettledReferral', () => {
  it('is null while the day has not happened, whatever the status', () => {
    expect(describeSettledReferral({ outcome: 'booked' })).toBeNull();
    expect(describeSettledReferral({})).toBeNull();
  });

  it('stops a cancel or a move once the household has collected', () => {
    expect(describeSettledReferral({ outcome: 'attended' })).toMatch(/no longer be cancelled/);
  });

  it('names copying as the answer for a no-show, so the two are not alternatives', () => {
    const message = describeSettledReferral({ outcome: 'no_show' });
    expect(message).toMatch(/no longer be cancelled or moved/);
    expect(message).toMatch(/[Cc]opy it to another session/);
  });

  it('is a different refusal from being locked, because amending survives it', () => {
    // A name spelt wrong on a referral whose household already collected is
    // still worth correcting: only cancelling and moving are refused, so this
    // must never be folded into `describeLockedReferral`.
    expect(describeLockedReferral({ status: 'reviewed' })).toBeNull();
    expect(describeSettledReferral({ outcome: 'attended' })).not.toBeNull();
  });
});

describe('cameFromCopy', () => {
  it('is true only for the flag the copy navigation sets', () => {
    expect(cameFromCopy({ fromCopy: true })).toBe(true);
  });

  it('reads anything else out of the browser’s history as no', () => {
    expect(cameFromCopy(null)).toBe(false);
    expect(cameFromCopy(undefined)).toBe(false);
    expect(cameFromCopy({})).toBe(false);
    expect(cameFromCopy({ fromCopy: 'yes' })).toBe(false);
    expect(cameFromCopy({ fromSearch: true })).toBe(false);
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

describe('REFERRAL_STATUS_LABELS', () => {
  // The two passes are not one scale. `pending_review` is a decision about the
  // *referrer* the charity did not recognise; `active → reviewed` is an
  // administrator reading the referral through. Labelling the first with the
  // word "review" made it read as an earlier stage of the second, and made
  // "Active" — the pile still to be read — look like a referral needing
  // nothing. `screenDetails.md`, "Referrals awaiting a decision".
  it('never spends the word "review" on the referrer decision', () => {
    expect(REFERRAL_STATUS_LABELS.pending_review).toBe('Approve referrer');
    expect(REFERRAL_STATUS_LABELS.pending_review).not.toMatch(/review/i);
  });

  it('names the read-through pass on both of its statuses', () => {
    expect(REFERRAL_STATUS_LABELS.active).toBe('Pending review');
    expect(REFERRAL_STATUS_LABELS.reviewed).toBe('Reviewed');
  });

  it('gives every status a distinct label, so no two read as the same state', () => {
    const labels = Object.values(REFERRAL_STATUS_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('needsReferrerApproval', () => {
  it('is true only for the referral held on an unrecognised referrer', () => {
    expect(needsReferrerApproval({ status: 'pending_review' })).toBe(true);
    // Not the read-through pass: neither of these is waiting on a referrer.
    expect(needsReferrerApproval({ status: 'active' })).toBe(false);
    expect(needsReferrerApproval({ status: 'reviewed' })).toBe(false);
    expect(needsReferrerApproval({ status: 'rejected' })).toBe(false);
    expect(needsReferrerApproval({ status: 'cancelled' })).toBe(false);
  });
});

describe('sortForReview', () => {
  it('puts referrals waiting on a referrer decision first, each group newest first', () => {
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

describe('canCopyReferral', () => {
  it('is true for a cancelled or rejected referral, whatever outcome the server sends', () => {
    expect(canCopyReferral(referral({ id: 'r1', status: 'cancelled' }))).toBe(true);
    expect(canCopyReferral(referral({ id: 'r1', status: 'rejected' }))).toBe(true);
  });

  it('is true for a no-show, whether the referral is reviewed or still active', () => {
    expect(canCopyReferral(referral({ id: 'r1', status: 'reviewed', outcome: 'no_show' }))).toBe(
      true,
    );
    expect(canCopyReferral(referral({ id: 'r1', status: 'active', outcome: 'no_show' }))).toBe(
      true,
    );
  });

  it('is false for a household who attended or is still booked, on either status', () => {
    expect(canCopyReferral(referral({ id: 'r1', status: 'active', outcome: 'attended' }))).toBe(
      false,
    );
    expect(canCopyReferral(referral({ id: 'r1', status: 'reviewed', outcome: 'attended' }))).toBe(
      false,
    );
    expect(canCopyReferral(referral({ id: 'r1', status: 'active', outcome: 'booked' }))).toBe(
      false,
    );
    expect(canCopyReferral(referral({ id: 'r1', status: 'reviewed', outcome: 'booked' }))).toBe(
      false,
    );
  });

  it('is false while awaiting review, which has no outcome yet', () => {
    expect(canCopyReferral(referral({ id: 'r1', status: 'pending_review' }))).toBe(false);
  });

  it('is false when the outcome key is genuinely absent — a GET /referrals list row — never read as booked', () => {
    const row = referral({ id: 'r1', status: 'active' });
    expect('outcome' in row).toBe(false);
    expect(canCopyReferral(row)).toBe(false);
  });
});

describe('displayedOutcome', () => {
  it('is null for a cancelled or rejected referral even though the server sends outcome: booked', () => {
    // `screenDetails.md`: "Cancelled" beside "Still booked" reads as a
    // household coming after all, so the status alone is shown.
    expect(displayedOutcome(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' }))).toBe(
      null,
    );
    expect(displayedOutcome(referral({ id: 'r1', status: 'rejected', outcome: 'booked' }))).toBe(
      null,
    );
  });

  it('returns the outcome for an active or reviewed referral, where it says something new', () => {
    expect(displayedOutcome(referral({ id: 'r1', status: 'active', outcome: 'no_show' }))).toBe(
      'no_show',
    );
    expect(displayedOutcome(referral({ id: 'r1', status: 'reviewed', outcome: 'attended' }))).toBe(
      'attended',
    );
  });

  it('is null when the outcome key is absent, rather than throwing or reading as booked', () => {
    expect(displayedOutcome(referral({ id: 'r1', status: 'active' }))).toBe(null);
  });
});

describe('copyCapacityWarning', () => {
  it('is null well under capacity', () => {
    expect(copyCapacityWarning({ booked: 10, capacity: 25 })).toBeNull();
  });

  it('names booked and capacity once the session is full or over', () => {
    const warning = copyCapacityWarning({ booked: 25, capacity: 25 });
    expect(warning).toContain('25');
    expect(warning).toContain('places booked');
  });
});
