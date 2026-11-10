import { describe, expect, it } from 'vitest';
import {
  REASON_ADDITIONAL_KEY,
  SECONDARY_REASON_KEY,
  answerChoiceId,
  answerText,
  referralSearchInput,
  surnamePrefixState,
} from './referral-search.logic';

describe('referral-search answer extraction', () => {
  it('takes the additional information and secondary reason from the dynamic answers map', () => {
    const answers = {
      [REASON_ADDITIONAL_KEY]: 'Rent arrears',
      [SECONDARY_REASON_KEY]: ['reason-2'],
    };

    expect(answerText(answers, REASON_ADDITIONAL_KEY)).toBe('Rent arrears');
    expect(answerChoiceId(answers, SECONDARY_REASON_KEY)).toBe('reason-2');
  });

  it('does not mistake malformed or absent dynamic answers for a value', () => {
    expect(answerText({}, REASON_ADDITIONAL_KEY)).toBe('—');
    expect(answerChoiceId({ [SECONDARY_REASON_KEY]: 'reason-2' }, SECONDARY_REASON_KEY)).toBeNull();
    expect(
      answerChoiceId({ [SECONDARY_REASON_KEY]: ['reason-1', 'reason-2'] }, SECONDARY_REASON_KEY),
    ).toBeNull();
  });
});

describe('referral search input', () => {
  const none = { dateOfBirth: '', postcode: '', phone: '', surnamePrefix: '' };

  it('counts a surname start from its first non-space character and keeps a trailing space', () => {
    expect(surnamePrefixState('')).toBe('empty');
    expect(surnamePrefixState('   ')).toBe('empty');
    expect(surnamePrefixState('Ro')).toBe('too-short');
    expect(surnamePrefixState('  Ro')).toBe('too-short');
    expect(surnamePrefixState('Di ')).toBe('usable');
    expect(surnamePrefixState('Row')).toBe('usable');
  });

  it('searches on a surname start alone, sent untrimmed', () => {
    expect(referralSearchInput({ ...none, surnamePrefix: 'Di ' })).toEqual({
      surnamePrefix: 'Di ',
    });
  });

  it('sends only the boxes that were filled in', () => {
    expect(referralSearchInput({ ...none, postcode: 'GU23 4XX', surnamePrefix: 'Row' })).toEqual({
      postcode: 'GU23 4XX',
      surnamePrefix: 'Row',
    });
  });

  it('makes no search from empty boxes or a surname start of spaces', () => {
    expect(referralSearchInput(none)).toBeNull();
    expect(referralSearchInput({ ...none, surnamePrefix: '   ' })).toBeNull();
  });

  it('refuses a short surname start rather than dropping it and widening the search', () => {
    expect(
      referralSearchInput({ ...none, dateOfBirth: '1985-03-04', surnamePrefix: 'Ro' }),
    ).toBeNull();
  });
});
