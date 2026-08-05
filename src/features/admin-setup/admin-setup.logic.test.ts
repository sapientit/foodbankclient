import { describe, expect, it } from 'vitest';
import type { AdminReferralReason, AuthorisedReferrer } from './queries';
import {
  blockedActiveDomain,
  displayMatchValue,
  findAuthorisedReferrer,
  findReferralReasonByCode,
  normaliseDomainInput,
  parseDisplayOrder,
  sortAuthorisedReferrers,
  sortReferralReasons,
} from './admin-setup.logic';

function referrer(overrides: Partial<AuthorisedReferrer> = {}): AuthorisedReferrer {
  return {
    id: 'r1',
    matchType: 'email',
    matchValue: 'anna@guildford.gov.uk',
    organisationName: 'Guildford Council',
    isActive: true,
    notes: null,
    ...overrides,
  };
}

function reason(overrides: Partial<AdminReferralReason> = {}): AdminReferralReason {
  return {
    id: 'q1',
    code: 'financial_hardship',
    label: 'Financial hardship',
    displayOrder: 0,
    isActive: true,
    ...overrides,
  };
}

describe('normaliseDomainInput', () => {
  it('strips a leading "*@"', () => {
    expect(normaliseDomainInput('*@guildford.gov.uk')).toBe('guildford.gov.uk');
  });

  it('strips a leading "@" with no asterisk', () => {
    expect(normaliseDomainInput('@guildford.gov.uk')).toBe('guildford.gov.uk');
  });

  it('leaves a bare domain untouched', () => {
    expect(normaliseDomainInput('guildford.gov.uk')).toBe('guildford.gov.uk');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseDomainInput('  guildford.gov.uk  ')).toBe('guildford.gov.uk');
  });
});

describe('displayMatchValue', () => {
  it('re-adds "*@" to a stored domain', () => {
    expect(displayMatchValue({ matchType: 'domain', matchValue: 'guildford.gov.uk' })).toBe(
      '*@guildford.gov.uk',
    );
  });

  it('leaves an email address exactly as stored', () => {
    expect(displayMatchValue({ matchType: 'email', matchValue: 'anna@guildford.gov.uk' })).toBe(
      'anna@guildford.gov.uk',
    );
  });

  it('round-trips every form of domain input to the same display value', () => {
    // *@example.org typed in is sent as example.org and shown back as *@example.org —
    // the whole reason `normaliseDomainInput` and `displayMatchValue` are
    // separate, tested functions rather than one another's inverse assumed
    // to hold.
    for (const typed of ['*@example.org', '@example.org', 'example.org']) {
      const stored = normaliseDomainInput(typed);
      expect(displayMatchValue({ matchType: 'domain', matchValue: stored })).toBe('*@example.org');
    }
  });
});

describe('sortAuthorisedReferrers', () => {
  it('orders by organisation, then by match value', () => {
    const rows = [
      referrer({ id: 'r2', organisationName: 'Zebra Trust', matchValue: 'z@zebra.org' }),
      referrer({ id: 'r1', organisationName: 'Anchor Support', matchValue: 'a@anchor.org' }),
    ];
    expect(sortAuthorisedReferrers(rows).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('breaks a tied organisation by match value', () => {
    const rows = [
      referrer({ id: 'r2', organisationName: 'Anchor Support', matchValue: 'zed@anchor.org' }),
      referrer({ id: 'r1', organisationName: 'Anchor Support', matchValue: 'ann@anchor.org' }),
    ];
    expect(sortAuthorisedReferrers(rows).map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('blockedActiveDomain', () => {
  it('names the domain an inactive email row blocks, when that domain is still active', () => {
    // An inactive email row is a block, not dead data — this is the
    // interesting case the whole feature exists to make visible.
    const inactiveEmail = referrer({
      id: 'r1',
      matchType: 'email',
      matchValue: 'anna@guildford.gov.uk',
      isActive: false,
    });
    const activeDomain = referrer({
      id: 'r2',
      matchType: 'domain',
      matchValue: 'guildford.gov.uk',
      isActive: true,
    });
    expect(blockedActiveDomain([inactiveEmail, activeDomain], inactiveEmail)).toBe(
      'guildford.gov.uk',
    );
  });

  it('is null for an inactive email row with no matching active domain', () => {
    const inactiveEmail = referrer({
      id: 'r1',
      matchType: 'email',
      matchValue: 'anna@guildford.gov.uk',
      isActive: false,
    });
    expect(blockedActiveDomain([inactiveEmail], inactiveEmail)).toBeNull();
  });

  it('is null for an active email row', () => {
    const activeEmail = referrer({
      id: 'r1',
      matchType: 'email',
      matchValue: 'anna@guildford.gov.uk',
      isActive: true,
    });
    const activeDomain = referrer({
      id: 'r2',
      matchType: 'domain',
      matchValue: 'guildford.gov.uk',
      isActive: true,
    });
    expect(blockedActiveDomain([activeEmail, activeDomain], activeEmail)).toBeNull();
  });

  it('is null for a domain row, whatever its status', () => {
    const inactiveDomain = referrer({
      id: 'r1',
      matchType: 'domain',
      matchValue: 'guildford.gov.uk',
      isActive: false,
    });
    expect(blockedActiveDomain([inactiveDomain], inactiveDomain)).toBeNull();
  });

  it('is null when the matching domain row is itself inactive', () => {
    const inactiveEmail = referrer({
      id: 'r1',
      matchType: 'email',
      matchValue: 'anna@guildford.gov.uk',
      isActive: false,
    });
    const inactiveDomain = referrer({
      id: 'r2',
      matchType: 'domain',
      matchValue: 'guildford.gov.uk',
      isActive: false,
    });
    expect(blockedActiveDomain([inactiveEmail, inactiveDomain], inactiveEmail)).toBeNull();
  });
});

describe('findAuthorisedReferrer', () => {
  it('finds an existing domain row from any of the three typed forms', () => {
    const rows = [referrer({ id: 'r1', matchType: 'domain', matchValue: 'guildford.gov.uk' })];

    for (const typed of ['*@guildford.gov.uk', '@guildford.gov.uk', 'guildford.gov.uk']) {
      expect(findAuthorisedReferrer(rows, 'domain', typed)?.id).toBe('r1');
    }
  });

  it('does not match a domain row against an email lookup, or vice versa', () => {
    const rows = [referrer({ id: 'r1', matchType: 'domain', matchValue: 'guildford.gov.uk' })];
    expect(findAuthorisedReferrer(rows, 'email', 'guildford.gov.uk')).toBeUndefined();
  });

  it('finds an inactive row — the duplicate check never filters these out', () => {
    const rows = [
      referrer({
        id: 'r1',
        matchType: 'email',
        matchValue: 'anna@guildford.gov.uk',
        isActive: false,
      }),
    ];
    expect(findAuthorisedReferrer(rows, 'email', 'anna@guildford.gov.uk')?.id).toBe('r1');
  });

  it('is undefined for an empty value', () => {
    const rows = [referrer()];
    expect(findAuthorisedReferrer(rows, 'domain', '*@')).toBeUndefined();
  });
});

describe('sortReferralReasons', () => {
  it('orders by displayOrder, then by label', () => {
    const rows = [
      reason({ id: 'q2', label: 'Zebra reason', displayOrder: 1 }),
      reason({ id: 'q1', label: 'Anchor reason', displayOrder: 0 }),
    ];
    expect(sortReferralReasons(rows).map((r) => r.id)).toEqual(['q1', 'q2']);
  });

  it('breaks a tied displayOrder by label', () => {
    const rows = [
      reason({ id: 'q2', label: 'Zebra reason', displayOrder: 0 }),
      reason({ id: 'q1', label: 'Anchor reason', displayOrder: 0 }),
    ];
    expect(sortReferralReasons(rows).map((r) => r.id)).toEqual(['q1', 'q2']);
  });
});

describe('findReferralReasonByCode', () => {
  it('finds an existing code, including a retired one', () => {
    const rows = [reason({ id: 'q1', code: 'domestic_abuse', isActive: false })];
    expect(findReferralReasonByCode(rows, 'domestic_abuse')?.id).toBe('q1');
  });

  it('is case-sensitive — the pattern already forbids anything a fold would change', () => {
    const rows = [reason({ id: 'q1', code: 'domestic_abuse' })];
    expect(findReferralReasonByCode(rows, 'DOMESTIC_ABUSE')).toBeUndefined();
  });

  it('is undefined for an empty code', () => {
    expect(findReferralReasonByCode([reason()], '')).toBeUndefined();
  });
});

describe('parseDisplayOrder', () => {
  it('accepts a whole number', () => {
    expect(parseDisplayOrder('3')).toEqual({ ok: true, value: 3 });
  });

  it('accepts a negative whole number — a reason legitimately sorted before everything else', () => {
    expect(parseDisplayOrder('-1')).toEqual({ ok: true, value: -1 });
  });

  it('accepts zero', () => {
    expect(parseDisplayOrder('0')).toEqual({ ok: true, value: 0 });
  });

  it('rejects an empty box', () => {
    expect(parseDisplayOrder('   ')).toEqual({ ok: false, problem: 'empty' });
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseDisplayOrder('1.5')).toEqual({ ok: false, problem: 'not-a-whole-number' });
    expect(parseDisplayOrder('abc')).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });
});
