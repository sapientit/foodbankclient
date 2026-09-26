import { describe, expect, it } from 'vitest';
import { parseReferralFormConfig } from '../referrals/referral-form-config';
import { buildPickListInformation } from './pick-list-information';

const definition = parseReferralFormConfig({
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Food',
      questions: [
        {
          questionNum: 1,
          questionKey: 'Allergies',
          questionTitle: 'Allergies?',
          required: false,
          preference: true,
          pickListInformation: 'Yes',
          validation: { type: 'String', maxLength: 500 },
        },
        {
          questionNum: 2,
          questionKey: 'Pulses',
          questionTitle: 'Pulses?',
          required: false,
          preference: true,
          pickListInformation: 'Yes',
          validation: { type: 'String', maxLength: 500 },
        },
        {
          questionNum: 3,
          questionKey: 'Dietary',
          questionTitle: 'Dietary?',
          required: false,
          preference: true,
          validation: { type: 'String', maxLength: 500 },
        },
      ],
    },
  ],
});

describe('buildPickListInformation', () => {
  it('creates a compact annotation from marked answers in form order', () => {
    expect(
      buildPickListInformation(
        [
          {
            id: 'referral-1',
            answers: {
              Allergies: '  2 people who are vegan.  ',
              Pulses: 'Kidney beans please.',
              Dietary: 'Vegetarian',
            },
          },
        ],
        {},
        definition,
      ),
    ).toEqual([
      {
        referralId: 'referral-1',
        notes: 'Allergies: 2 people who are vegan.\nPulses: Kidney beans please.',
      },
    ]);
  });

  it('omits blank and unmarked answers instead of creating an empty note', () => {
    expect(
      buildPickListInformation(
        [{ id: 'referral-1', answers: { Allergies: '  ', Dietary: 'Vegetarian' } }],
        {},
        definition,
      ),
    ).toEqual([]);
  });

  it('appends a deterministic, deduplicated note for stock a historic release resolved to nothing', () => {
    expect(
      buildPickListInformation(
        [{ id: 'referral-1', answers: { Allergies: 'Nut allergy' } }],
        {},
        definition,
        new Map([['referral-1', ['Marmite', 'Beans', 'Marmite']]]),
      ),
    ).toEqual([
      {
        referralId: 'referral-1',
        notes: 'Allergies: Nut allergy\nNo longer stocked: Beans, Marmite.',
      },
    ]);
  });

  it('adds the note even when there is no marked-question information at all', () => {
    expect(
      buildPickListInformation(
        [{ id: 'referral-1', answers: {} }],
        {},
        definition,
        new Map([['referral-1', ['Marmite']]]),
      ),
    ).toEqual([{ referralId: 'referral-1', notes: 'No longer stocked: Marmite.' }]);
  });
});
