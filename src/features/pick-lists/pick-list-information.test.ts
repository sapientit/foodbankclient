import { describe, expect, it } from 'vitest';
import { parseReferralFormConfig } from '../referrals/referral-form-config';
import { buildPickListInformation, composeInformationForPickers } from './pick-list-information';

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
  it('writes only the No longer stocked note, deduplicated and in order', () => {
    expect(
      buildPickListInformation(
        new Map([
          ['referral-1', ['Marmite', 'Custard', 'Marmite']],
          ['referral-2', []],
        ]),
      ),
    ).toEqual([{ referralId: 'referral-1', notes: 'No longer stocked: Custard, Marmite.' }]);
  });

  it('sends nothing where no stock was dropped', () => {
    expect(buildPickListInformation(new Map())).toEqual([]);
  });
});

describe('composeInformationForPickers', () => {
  const parcel = {
    picklistAdmin: 'Ring the bell twice',
    answers: {
      Allergies: '  2 people who are vegan.  ',
      Pulses: 'Kidney beans please.',
      Dietary: 'Vegetarian',
    },
    notes: 'No longer stocked: Marmite.',
  };

  it('puts the admin notes first, then the marked answers in form order, then the stored note', () => {
    expect(composeInformationForPickers(parcel, definition, {})).toBe(
      [
        'Ring the bell twice',
        'Allergies: 2 people who are vegan.',
        'Pulses: Kidney beans please.',
        'No longer stocked: Marmite.',
      ].join('\n'),
    );
  });

  it('leaves out each empty part rather than a blank line', () => {
    expect(
      composeInformationForPickers(
        { picklistAdmin: '   ', answers: { Allergies: '', Pulses: 'Lentils' }, notes: null },
        definition,
        {},
      ),
    ).toBe('Pulses: Lentils');
  });

  it('is null when there is nothing to tell the picker', () => {
    expect(
      composeInformationForPickers(
        { picklistAdmin: null, answers: { Dietary: 'Vegetarian' }, notes: null },
        definition,
        {},
      ),
    ).toBeNull();
  });

  it('never carries an answer the form does not mark, such as the reason for referral', () => {
    const composed = composeInformationForPickers(
      { ...parcel, answers: { ...parcel.answers, 'Reason for referral': 'Never print this' } },
      definition,
      {},
    );
    expect(composed).not.toContain('Vegetarian');
    expect(composed).not.toContain('Never print this');
  });

  it('still shows the admin notes and stored note when the parcel’s release is unknown', () => {
    expect(composeInformationForPickers(parcel, null, {})).toBe(
      'Ring the bell twice\nNo longer stocked: Marmite.',
    );
  });
});
