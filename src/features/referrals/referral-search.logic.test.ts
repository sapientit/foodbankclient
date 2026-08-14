import { describe, expect, it } from 'vitest';
import {
  REASON_ADDITIONAL_KEY,
  SECONDARY_REASON_KEY,
  answerChoiceId,
  answerText,
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
