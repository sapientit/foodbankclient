import { expect, it } from 'vitest';

import { parseReferralFormConfig } from '../../src/features/referrals/referral-form-config';

const input: unknown = import.meta.env.VITE_FOODBANK_TAKEON_QUESTIONNAIRE;

it.runIf(input !== undefined)(
  'accepts the proposed take-on questionnaire using the application parser',
  () => {
    expect(input).toBeTypeOf('string');
    const json = typeof input === 'string' ? input : '';
    expect(() => parseReferralFormConfig(JSON.parse(json)).pages).toBeDefined();
  },
);
