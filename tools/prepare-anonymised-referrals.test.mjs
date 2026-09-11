import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCsv, prepareReferrals } from './prepare-anonymised-referrals.mjs';

const questionnaire = {
  pages: [
    {
      questions: [
        { questionKey: 'Pasta/Rice', answers: ['Pasta', 'Rice', 'Both'] },
        {
          questionKey: 'Tea/Coffee',
          answers: ['Tea', 'Coffee', 'Hot Chocolate'],
          validation: { answerMax: 2 },
        },
        { questionKey: 'Eggs', answers: ['Yes', 'No'] },
        {
          questionKey: 'Toiletries',
          answers: ['Soap', 'Toothbrush'],
          validation: { answerMax: 3 },
        },
        {
          questionKey: 'Household',
          answers: ['Laundry detergent', 'Spray cleaner'],
          validation: { answerMax: 3 },
        },
      ],
    },
  ],
};

const headers = [
  'Timestamp',
  'Number of adults in clients family',
  "Number of children in client's family",
  'Number of children in each age bracket (if unknown tick 0) [Age 0-2]',
  'Number of children in each age bracket (if unknown tick 0) [Age 3-4]',
  'Number of children in each age bracket (if unknown tick 0) [Age 5-11]',
  'Number of children in each age bracket (if unknown tick 0) [Age 12-17]',
  'How will the parcel be collected?',
  'Would they prefer pasta or rice?',
  'Would they prefer tea, coffee or hot chocolate?',
  'Would they like eggs?',
  'Please select which THREE toiletries they require most. We give everyone toilet roll.',
  'Please select which THREE household items they require most.',
]
  .map((header) => `"${header.replaceAll('"', '""')}"`)
  .join(',');

test('parses quoted CSV cells without creating an extra row', () => {
  assert.deepEqual(parseCsv('a,b\n"one, two",three\n'), [
    ['a', 'b'],
    ['one, two', 'three'],
  ]);
});

test('prepares timestamped legacy rows as anonymised, system-independent scenarios', () => {
  const csv = `${headers}\n,,,,,,,,,,,,\n2026-09-01,2,3,1,0,1,1,Delivery,"Pasta, Rice",Coffee,Yes,"Soap, Toothbrush","Laundry detergent, Spray cleaner"\n`;
  const result = prepareReferrals({ csv, questionnaire });

  assert.equal(result.report.sourceRows, 1);
  assert.equal(result.report.prepared, 1);
  assert.deepEqual(result.report.unresolved, []);
  assert.deepEqual(result.referrals, [
    {
      referrerName: 'referrer1',
      referrerEmail: 'referrer1@example.test',
      referrerOrganisation: 'Test organisation',
      referrerPhone: '0000000001',
      refereeFirstName: 'name1',
      refereeSurname: 'surname1',
      refereeDateOfBirth: '1980-01-01',
      refereeAddress: '1 Test Street',
      refereePostcode: 'TE1 1ST',
      refereePhone: '0000000101',
      adults: 3,
      children: 1,
      collectionMethod: 'collection',
      needsFuelHelp: false,
      answers: {
        gender: 'Female',
        ethnicity: 'White -British',
        'source of income': 'Benefits',
        'Household Components': {
          '0-4': { female: 1 },
          '5-11': { female: 1 },
          '12-17': { female: 1 },
          'working-age': { female: 2 },
        },
        'Cooking Facility': ['Oven'],
        'Pasta/Rice': 'Both',
        'Tea/Coffee': ['Coffee'],
        Eggs: 'Yes',
        Toiletries: ['Soap', 'Toothbrush'],
        Household: ['Laundry detergent', 'Spray cleaner'],
      },
    },
  ]);
});

test('reports an unmatched structured preference without echoing its source value', () => {
  const csv = `${headers}\n2026-09-01,1,0,0,0,0,0,Collection,Unrecognised,,,,,\n`;
  const result = prepareReferrals({ csv, questionnaire });
  assert.deepEqual(result.report.unresolved, [
    { row: 2, source: 'Pasta/Rice', reason: 'no current option matches' },
  ]);
});

test('treats an old no-preference answer as no current answer', () => {
  const csv = `${headers}\n2026-09-01,1,0,0,0,0,0,Collection,No preference,,,,,\n`;
  const result = prepareReferrals({ csv, questionnaire });
  assert.deepEqual(result.report.unresolved, []);
  assert.equal(Object.hasOwn(result.referrals[0].answers, 'Pasta/Rice'), false);
});

test('omits explanatory legacy default text instead of treating it as a preference', () => {
  const csv = `${headers}\n2026-09-01,1,0,0,0,0,0,Collection,A standard parcel includes pasta,,,,,\n`;
  const result = prepareReferrals({ csv, questionnaire });
  assert.deepEqual(result.report.unresolved, []);
  assert.equal(Object.hasOwn(result.referrals[0].answers, 'Pasta/Rice'), false);
});
