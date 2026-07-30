import { describe, expect, it } from 'vitest';
import { looksLikeEmail, normaliseEmail, sortByStart } from './public-referral.logic';
import type { PublicSession } from './queries';

function session(overrides: Partial<PublicSession> & { id: string }): PublicSession {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 120,
    location: 'St Mary’s Hall',
    ...overrides,
  };
}

describe('looksLikeEmail', () => {
  it('asks the server nothing until there is an address to ask about', () => {
    // Every one of these is a keystroke on the way to a real address, and every
    // one would be a request against a budget of roughly sixty a minute for the
    // whole food bank.
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('a')).toBe(false);
    expect(looksLikeEmail('ada@')).toBe(false);
    expect(looksLikeEmail('ada@charity')).toBe(false);
    expect(looksLikeEmail('ada@charity.')).toBe(false);
  });

  it('accepts an address the server might recognise', () => {
    expect(looksLikeEmail('ada@charity.org')).toBe(true);
    expect(looksLikeEmail('ada.lovelace@sub.charity.org.uk')).toBe(true);
  });

  it('does not try to validate, because the server decides', () => {
    // Generous on purpose: a false positive costs one request that answers
    // "not authorised", which is what the screen would have shown anyway.
    expect(looksLikeEmail("o'brien+referrals@st-marys.sch.uk")).toBe(true);
  });
});

describe('normaliseEmail', () => {
  it('matches the way the server stores an address, so one address is one request', () => {
    expect(normaliseEmail('  Ada@Charity.ORG ')).toBe('ada@charity.org');
  });
});

describe('sortByStart', () => {
  it('orders sessions by startsAtUtc, not by the wall clock', () => {
    /*
     * The BST changeover, which is the whole reason this rule exists. Both
     * sessions say 01:30, and the second is an hour later in real time — an hour
     * that only the instant knows about.
     */
    const later = session({
      id: 'later',
      sessionDate: '2026-10-25',
      startTime: '01:30',
      startsAtUtc: '2026-10-25T01:30:00.000Z',
    });
    const earlier = session({
      id: 'earlier',
      sessionDate: '2026-10-25',
      startTime: '01:30',
      startsAtUtc: '2026-10-25T00:30:00.000Z',
    });

    expect(sortByStart([later, earlier]).map((s) => s.id)).toEqual(['earlier', 'later']);
  });

  it('does not mutate what the query gave it', () => {
    const first = session({ id: 'b', startsAtUtc: '2026-08-05T09:00:00.000Z' });
    const second = session({ id: 'a', startsAtUtc: '2026-08-04T09:00:00.000Z' });
    const input = [first, second];

    sortByStart(input);

    expect(input.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('sorts an unparseable instant last rather than scrambling the whole list', () => {
    const broken = session({ id: 'broken', startsAtUtc: 'not a timestamp' });
    const monday = session({ id: 'monday', startsAtUtc: '2026-08-03T09:00:00.000Z' });
    const tuesday = session({ id: 'tuesday', startsAtUtc: '2026-08-04T09:00:00.000Z' });

    expect(sortByStart([broken, tuesday, monday]).map((s) => s.id)).toEqual([
      'monday',
      'tuesday',
      'broken',
    ]);
  });
});
