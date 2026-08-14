import { describe, expect, it, vi } from 'vitest';
import type { ReferralFormDefinition } from '../referrals/referral-form-definition';
import type { StockItem } from '../stock/queries';

vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

import {
  parsePreferenceRuleConfig,
  resolvePreferenceLines,
  validatePreferenceRules,
  type PreferenceRule,
} from './preference-rules';

const STOCK_ITEMS: readonly StockItem[] = [
  {
    id: 'detergent',
    name: 'Detergent',
    category: 'Household',
    description: null,
    shelfNumber: 'A1',
    isActive: true,
  },
  {
    id: 'shaving-foam',
    name: 'Shaving foam',
    category: 'Toiletries',
    description: null,
    shelfNumber: 'B1',
    isActive: true,
  },
  {
    id: 'small-laundry-powder',
    name: 'Laundry powder small',
    category: 'Household',
    description: null,
    shelfNumber: 'A2',
    isActive: true,
  },
  {
    id: 'large-laundry-powder',
    name: 'Laundry powder large',
    category: 'Household',
    description: null,
    shelfNumber: 'A3',
    isActive: true,
  },
  {
    id: 'wipes',
    name: 'Wipes',
    category: 'Baby',
    description: null,
    shelfNumber: 'C1',
    isActive: true,
  },
];

const STOCK_ITEMS_WITH_BLEACH: readonly StockItem[] = [
  ...STOCK_ITEMS,
  {
    id: 'bleach',
    name: 'Bleach',
    category: 'Household',
    description: null,
    shelfNumber: 'A4',
    isActive: true,
  },
];

const HOUSEHOLD_PREFERENCE: ReferralFormDefinition = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Preferences',
      questions: [
        {
          type: 'choice',
          key: 'Household',
          label: 'Household items',
          required: false,
          preference: true,
          answerMin: 0,
          answerMax: 3,
          options: [
            { value: 'Detergent', label: 'Detergent' },
            { value: 'Bleach', label: 'Bleach' },
            { value: 'Laundry Powder', label: 'Laundry Powder' },
          ],
        },
        {
          type: 'choice',
          key: 'Nappies',
          label: 'Nappies',
          required: false,
          preference: true,
          answerMin: 0,
          answerMax: 2,
          options: [
            { value: 'Size 1', label: 'Size 1' },
            { value: 'Size 2', label: 'Size 2' },
          ],
        },
      ],
    },
  ],
};

const SELECTED_ANSWER_RULE: readonly PreferenceRule[] = [
  {
    when: { key: 'Household' },
    cases: [
      {
        familySize: { people: 'total', atLeast: 3 },
        set: [{ stock: '$selectedAnswer', quantity: 2 }],
      },
    ],
    otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
  },
];

describe('validatePreferenceRules', () => {
  it('rejects $selectedAnswer as an answer trigger', () => {
    expect(() =>
      parsePreferenceRuleConfig({
        rules: [
          {
            when: { key: 'Household', hasAnswer: '$selectedAnswer' },
            cases: [],
            otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
          },
        ],
      }),
    ).toThrow('$selectedAnswer may only be used as a stock item.');
  });

  it('rejects selected-answer rules when any selectable answer is not active stock', () => {
    expect(
      validatePreferenceRules(STOCK_ITEMS, SELECTED_ANSWER_RULE, HOUSEHOLD_PREFERENCE).errors,
    ).toEqual([
      'Rule Household: $selectedAnswer cannot resolve active stock items for Bleach, Laundry Powder.',
    ]);
  });

  it('accepts a rule stock name with different capitalisation to the active item', () => {
    expect(
      validatePreferenceRules(
        STOCK_ITEMS_WITH_BLEACH,
        [
          {
            when: { key: 'Household' },
            cases: [],
            otherwise: { set: [{ stock: '  Shaving Foam  ', quantity: 1 }] },
          },
        ],
        HOUSEHOLD_PREFERENCE,
      ).errors,
    ).toEqual([]);
  });

  it('lets a specific earlier rule consume an answer before a broader rule', () => {
    const rules: readonly PreferenceRule[] = [
      {
        when: { key: 'Household', hasAnswer: 'Laundry Powder' },
        cases: [
          {
            familySize: { people: 'total', atLeast: 3 },
            set: [{ stock: 'Laundry powder large', quantity: 1 }],
          },
        ],
        otherwise: { set: [{ stock: 'Laundry powder small', quantity: 1 }] },
      },
      {
        when: { key: 'Household' },
        cases: [],
        otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
      },
    ];

    expect(
      resolvePreferenceLines(
        [
          {
            id: 'r1',
            adults: 2,
            children: 2,
            answers: { Household: ['Laundry Powder', 'Detergent'] },
          },
        ],
        STOCK_ITEMS_WITH_BLEACH,
        rules,
        HOUSEHOLD_PREFERENCE,
      ),
    ).toEqual([
      {
        referralId: 'r1',
        lines: [
          { stockItemId: 'large-laundry-powder', quantity: 1 },
          { stockItemId: 'detergent', quantity: 1 },
        ],
      },
    ]);
  });

  it('adds output from each selected answer while attention remains dominant', () => {
    const rules: readonly PreferenceRule[] = [
      {
        when: { key: 'Household' },
        cases: [],
        otherwise: { set: [{ stock: 'Wipes', quantity: 1 }] },
      },
      {
        when: { key: 'Nappies' },
        cases: [],
        otherwise: { set: [{ stock: 'Wipes', quantity: -1 }] },
      },
    ];

    expect(
      resolvePreferenceLines(
        [
          {
            id: 'r1',
            adults: 1,
            children: 0,
            answers: { Household: ['Detergent', 'Bleach'], Nappies: 'Size 1' },
          },
        ],
        STOCK_ITEMS,
        rules,
        HOUSEHOLD_PREFERENCE,
      ),
    ).toEqual([{ referralId: 'r1', lines: [{ stockItemId: 'wipes', quantity: -1 }] }]);
  });
});
