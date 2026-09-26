import { describe, expect, it } from 'vitest';
import type { ConfigurationRelease } from '../configuration-releases/queries';
import type { Referral } from '../referrals/queries';
import type { StockItem } from '../stock/queries';
import {
  anyReleaseNeedsOptionSources,
  distinctFormIds,
  parseReleases,
  resolvePickListBody,
} from './release-pick-list.logic';

function questionnaire(key: string, options: readonly string[]): string {
  return JSON.stringify({
    version: 1,
    pages: [
      {
        pageNum: 1,
        pageTitle: 'Preferences',
        questions: [
          {
            questionNum: 1,
            questionKey: key,
            questionTitle: key,
            preference: true,
            required: false,
            validation: { type: 'CheckBox', answerMin: 0, answerMax: options.length },
            answers: options,
          },
        ],
      },
    ],
  });
}

function rules(key: string): string {
  return JSON.stringify({
    rules: [{ when: { key }, otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] } }],
  });
}

const CURRENT: ConfigurationRelease = {
  formId: 'form-current',
  status: 'published',
  questionnaireHash: 'h',
  rulesHash: 'h',
  generationId: 'gen-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceWorkbookId: 'workbook',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdByUserId: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
  publishedByUserId: null,
  questionnaire: questionnaire('Toiletries', ['Soap']),
  rules: rules('Toiletries'),
};

const HISTORIC: ConfigurationRelease = {
  ...CURRENT,
  formId: 'form-old',
  status: 'superseded',
  questionnaire: questionnaire('Toiletries', ['Soap', 'Marmite']),
  rules: rules('Toiletries'),
};

const SOAP: StockItem = {
  id: 'soap',
  name: 'Soap',
  category: 'Toiletries',
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
};

function referral(overrides: Partial<Referral> & Pick<Referral, 'id' | 'formId'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-01-01T00:00:00.000Z',
    adults: 1,
    children: 0,
    householdSize: 1,
    isDelivery: false,
    collectionMethod: 'collection',
    needsFuelHelp: false,
    referrerOrganisation: 'Riverside Church',
    referrerName: 'Sam Referrer',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'AB1 2CD',
    refereePhone: null,
    answers: {},
    piiPurgedAt: null,
    reasonId: 'q1',
    referrerEmail: 'referrer@riverside.org',
    referrerPhone: null,
    reviewComment: null,
    repeatReferrals: { count: 0, mostRecentSessionDate: null },
    ...overrides,
  };
}

describe('distinctFormIds', () => {
  it('dedupes and drops null', () => {
    expect(
      distinctFormIds([
        referral({ id: 'r1', formId: 'form-a' }),
        referral({ id: 'r2', formId: 'form-a' }),
        referral({ id: 'r3', formId: 'form-b' }),
        referral({ id: 'r4', formId: null }),
      ]),
    ).toEqual(['form-a', 'form-b']);
  });
});

describe('anyReleaseNeedsOptionSources', () => {
  it('is false when nothing in any release marks a lookup-driven pick-list question', () => {
    expect(anyReleaseNeedsOptionSources(parseReleases([CURRENT, HISTORIC]))).toBe(false);
  });
});

describe('resolvePickListBody', () => {
  it('resolves each referral against the release named by its own formId', () => {
    const referrals = [
      referral({ id: 'r-current', formId: 'form-current', answers: { Toiletries: ['Soap'] } }),
      referral({ id: 'r-old', formId: 'form-old', answers: { Toiletries: ['Soap'] } }),
    ];

    const result = resolvePickListBody(referrals, [SOAP], parseReleases([CURRENT, HISTORIC]), {});

    expect(result.preferenceLines).toEqual(
      expect.arrayContaining([
        { referralId: 'r-current', lines: [{ stockItemId: 'soap', quantity: 1 }] },
        { referralId: 'r-old', lines: [{ stockItemId: 'soap', quantity: 1 }] },
      ]),
    );
  });

  it('drops and notes stock a historic release names that no longer exists, without throwing', () => {
    const referrals = [
      referral({ id: 'r-old', formId: 'form-old', answers: { Toiletries: ['Marmite'] } }),
    ];

    const result = resolvePickListBody(referrals, [SOAP], parseReleases([HISTORIC]), {});

    expect(result.preferenceLines).toEqual([]);
    expect(result.pickListInformation).toEqual([
      { referralId: 'r-old', notes: 'No longer stocked: Marmite.' },
    ]);
  });

  it('blocks generation when the published release itself cannot resolve its rules', () => {
    const referrals = [
      referral({ id: 'r-current', formId: 'form-current', answers: { Toiletries: ['Soap'] } }),
    ];

    expect(() => resolvePickListBody(referrals, [], parseReleases([CURRENT]), {})).toThrow(
      'Preference rule configuration is invalid',
    );
  });

  it('does not let a broken historic release block the published one', () => {
    // The published release resolves fine against no stock at all named
    // "Marmite" — only the historic one references it, and that release's
    // own health is never checked at all.
    const referrals = [
      referral({ id: 'r-current', formId: 'form-current', answers: { Toiletries: ['Soap'] } }),
      referral({ id: 'r-old', formId: 'form-old', answers: { Toiletries: ['Marmite'] } }),
    ];

    const result = resolvePickListBody(referrals, [SOAP], parseReleases([CURRENT, HISTORIC]), {});

    expect(result.preferenceLines).toEqual([
      { referralId: 'r-current', lines: [{ stockItemId: 'soap', quantity: 1 }] },
    ]);
  });

  it('resolves nothing for a referral with no known release, and never throws over it', () => {
    const referrals = [referral({ id: 'r-unknown', formId: null })];

    const result = resolvePickListBody(referrals, [SOAP], parseReleases([CURRENT]), {});

    expect(result.preferenceLines).toEqual([]);
    expect(result.pickListInformation).toEqual([]);
  });
});
