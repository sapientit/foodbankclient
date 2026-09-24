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
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
  {
    id: 'shaving-foam',
    name: 'Shaving foam',
    category: 'Toiletries',
    description: null,
    shelfNumber: 'B1',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
  {
    id: 'small-laundry-powder',
    name: 'Laundry powder small',
    category: 'Household',
    description: null,
    shelfNumber: 'A2',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
  {
    id: 'large-laundry-powder',
    name: 'Laundry powder large',
    category: 'Household',
    description: null,
    shelfNumber: 'A3',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
  {
    id: 'wipes',
    name: 'Wipes',
    category: 'Baby',
    description: null,
    shelfNumber: 'C1',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
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
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
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

const TOOTHBRUSH_PREFERENCE: ReferralFormDefinition = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Preferences',
      questions: [
        {
          type: 'choice',
          key: 'Toiletries',
          label: 'Toiletries',
          required: false,
          preference: true,
          answerMin: 0,
          answerMax: 1,
          options: [{ value: 'Toothbrush', label: 'Toothbrush' }],
        },
      ],
    },
  ],
};

const TOOTHBRUSH_STOCK_ITEM: StockItem = {
  id: 'toothbrush',
  name: 'Toothbrush',
  category: 'Toiletries',
  description: null,
  shelfNumber: 'B2',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
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
  it('accepts $dummy without a stock item, but still requires its quantity', () => {
    const config = {
      rules: [
        {
          when: { key: 'Toiletries', hasAnswer: 'Toothbrush' },
          cases: [],
          otherwise: { set: [{ stock: '$dummy', quantity: 1 }] },
        },
      ],
    };

    expect(parsePreferenceRuleConfig(config)).toEqual(config);
    expect(
      validatePreferenceRules([], parsePreferenceRuleConfig(config).rules, TOOTHBRUSH_PREFERENCE)
        .errors,
    ).toEqual([]);
    expect(() =>
      parsePreferenceRuleConfig({
        rules: [
          {
            when: { key: 'Toiletries', hasAnswer: 'Toothbrush' },
            cases: [],
            otherwise: { set: [{ stock: '$dummy' }] },
          },
        ],
      }),
    ).toThrow();
  });

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

  it('uses $dummy to consume Toothbrush before a later $selectedAnswer rule without a parcel line', () => {
    const rules: readonly PreferenceRule[] = [
      {
        when: { key: 'Toiletries', hasAnswer: 'Toothbrush' },
        cases: [],
        otherwise: { set: [{ stock: '$dummy', quantity: 1 }] },
      },
      {
        when: { key: 'Toiletries' },
        cases: [],
        otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
      },
    ];

    expect(
      resolvePreferenceLines(
        [
          {
            id: 'r1',
            adults: 1,
            children: 0,
            answers: { Toiletries: 'Toothbrush' },
          },
        ],
        [TOOTHBRUSH_STOCK_ITEM],
        rules,
        TOOTHBRUSH_PREFERENCE,
      ),
    ).toEqual([]);
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
