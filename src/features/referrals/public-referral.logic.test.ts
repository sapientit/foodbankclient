import { describe, expect, it } from 'vitest';
import {
  looksLikeEmail,
  normaliseEmail,
  referrerVerdict,
  sortByStart,
  suggestedOrganisation,
} from './public-referral.logic';
import type { PublicSession } from './queries';

function session(overrides: Partial<PublicSession> & { id: string }): PublicSession {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 120,
    location: 'St Mary’s Hall',
    deliveriesAllowed: false,
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

describe('referrerVerdict', () => {
  const unrecognised = { authorised: false, organisationName: null };
  const recognised = { authorised: true, organisationName: 'Guildford Borough Council' };

  it('never says an address is not recognised while it is still being typed', () => {
    /*
     * The bug this exists to stop. `pete@guildford.gov` is a complete-looking
     * address on the way to `pete@guildford.gov.uk`, so it gets checked and the
     * server rightly answers "no" — and the screen then told a recognised
     * referrer, in a live region, that the food bank did not know them.
     */
    expect(referrerVerdict({ checking: false, result: unrecognised, left: false })).toEqual({
      kind: 'silent',
    });
  });

  it('says it once they have left the address, which is still before any household details', () => {
    expect(referrerVerdict({ checking: false, result: unrecognised, left: true })).toEqual({
      kind: 'unrecognised',
    });
  });

  it('reassures a recognised referrer as soon as it knows, without waiting for them to leave', () => {
    expect(referrerVerdict({ checking: false, result: recognised, left: false })).toEqual({
      kind: 'authorised',
      organisationName: 'Guildford Borough Council',
    });
  });

  it('carries a null organisation rather than a name, so no screen can render the word null', () => {
    expect(
      referrerVerdict({
        checking: false,
        result: { authorised: true, organisationName: null },
        left: true,
      }),
    ).toEqual({ kind: 'authorised', organisationName: null });
  });

  it('says nothing at all before there is an answer', () => {
    expect(referrerVerdict({ checking: false, result: undefined, left: true })).toEqual({
      kind: 'silent',
    });
  });

  it('shows the check in progress ahead of an answer that is no longer about this address', () => {
    // A verdict in flight is a verdict for a different address: the previous
    // one must not be left on screen underneath a correction.
    expect(referrerVerdict({ checking: true, result: recognised, left: true })).toEqual({
      kind: 'checking',
    });
  });
});

describe('suggestedOrganisation', () => {
  const offered = ['Guildford Borough Council', 'Woking Borough Council'];

  it('offers the organisation a recognised address already belongs to', () => {
    expect(
      suggestedOrganisation(
        { authorised: true, organisationName: 'Guildford Borough Council' },
        offered,
      ),
    ).toBe('Guildford Borough Council');
  });

  it('suggests nothing for an address the charity does not recognise', () => {
    expect(
      suggestedOrganisation({ authorised: false, organisationName: null }, offered),
    ).toBeNull();
  });

  it('suggests nothing before there is an answer', () => {
    expect(suggestedOrganisation(undefined, offered)).toBeNull();
  });

  it('suggests nothing when the authorised referrer has no organisation', () => {
    expect(suggestedOrganisation({ authorised: true, organisationName: null }, offered)).toBeNull();
  });

  it('never suggests a name the dropdown does not offer', () => {
    // The select would fall back to "Choose one" while the answer said
    // otherwise — a box disagreeing with itself is worse than being asked.
    expect(
      suggestedOrganisation({ authorised: true, organisationName: 'Elmbridge Council' }, offered),
    ).toBeNull();
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
