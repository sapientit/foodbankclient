import { describe, expect, it } from 'vitest';
import { fuelAnswers } from './fuel-help.logic';

describe('fuelAnswers', () => {
  it('reads only the two configured fuel questions', () => {
    expect(
      fuelAnswers({
        'Pre-Payment': 'Yes',
        'Contact approved': 'No',
        'Cause Details': 'This answer must not be exposed here.',
      }),
    ).toEqual({ prePayment: 'Yes', contactApproved: 'No' });
  });

  it('labels missing answers without treating them as a filter', () => {
    expect(fuelAnswers({})).toEqual({
      prePayment: 'Not answered',
      contactApproved: 'Not answered',
    });
  });
});
