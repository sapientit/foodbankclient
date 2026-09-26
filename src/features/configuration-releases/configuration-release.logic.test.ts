import { describe, expect, it } from 'vitest';
import type { StockItem } from '../stock/queries';
import {
  manifestMatchesPayloads,
  parseConfigurationManifest,
  sha256Hex,
  validateConfigurationRelease,
} from './configuration-release.logic';

const STOCK_ITEMS: readonly StockItem[] = [
  {
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
  },
  {
    id: 'shampoo',
    name: 'Shampoo',
    category: 'Toiletries',
    description: null,
    shelfNumber: 'A2',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
];

const VALID_QUESTIONNAIRE = JSON.stringify({
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Preferences',
      questions: [
        {
          questionNum: 1,
          questionKey: 'Toiletries',
          questionTitle: 'Do you need any toiletries?',
          preference: true,
          required: false,
          validation: { type: 'CheckBox', answerMin: 0, answerMax: 5 },
          answers: ['Soap', 'Shampoo'],
        },
      ],
    },
  ],
});

const VALID_RULES = JSON.stringify({
  rules: [
    {
      when: { key: 'Toiletries' },
      otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
    },
  ],
});

function baseManifest() {
  return {
    version: 1,
    generationId: 'test-generation',
    generatedAt: '2026-01-01T00:00:00.000Z',
    questionnaireSha256: '',
    rulesSha256: '',
  };
}

describe('parseConfigurationManifest', () => {
  it('parses a well-formed manifest', () => {
    const manifest = parseConfigurationManifest(
      JSON.stringify({
        version: 1,
        generationId: 'abc',
        generatedAt: '2026-01-01T00:00:00.000Z',
        questionnaireSha256: 'aa',
        rulesSha256: 'bb',
      }),
    );
    expect(manifest.generationId).toBe('abc');
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseConfigurationManifest('not json')).toThrow(/not valid JSON/);
  });

  it('refuses JSON missing a required field', () => {
    expect(() =>
      parseConfigurationManifest(JSON.stringify({ version: 1, generationId: 'abc' })),
    ).toThrow(/missing something/);
  });
});

describe('sha256Hex', () => {
  it('matches the well-known digest of an empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces different digests for different content', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('manifestMatchesPayloads', () => {
  it('is true when both hashes match the payloads', async () => {
    const manifest = {
      ...baseManifest(),
      questionnaireSha256: await sha256Hex(VALID_QUESTIONNAIRE),
      rulesSha256: await sha256Hex(VALID_RULES),
    };

    expect(await manifestMatchesPayloads(manifest, VALID_QUESTIONNAIRE, VALID_RULES)).toBe(true);
  });

  it('is false when the questionnaire has changed since the manifest was generated', async () => {
    const manifest = {
      ...baseManifest(),
      questionnaireSha256: await sha256Hex(VALID_QUESTIONNAIRE),
      rulesSha256: await sha256Hex(VALID_RULES),
    };
    const editedQuestionnaire = VALID_QUESTIONNAIRE.replace('Toiletries', 'Toiletries edited');

    expect(await manifestMatchesPayloads(manifest, editedQuestionnaire, VALID_RULES)).toBe(false);
  });

  it('is false against a stale manifest generated from an older payload', async () => {
    const manifest = baseManifest();

    expect(await manifestMatchesPayloads(manifest, VALID_QUESTIONNAIRE, VALID_RULES)).toBe(false);
  });
});

describe('validateConfigurationRelease', () => {
  it('accepts a questionnaire and rules that agree with each other and with current stock', () => {
    const result = validateConfigurationRelease(VALID_QUESTIONNAIRE, VALID_RULES, STOCK_ITEMS);

    expect(result.errors).toEqual([]);
    expect(result.definition?.pages).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
  });

  it('reports a structurally invalid questionnaire and never reaches the rules', () => {
    const result = validateConfigurationRelease('not json', VALID_RULES, STOCK_ITEMS);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Questionnaire: /);
  });

  it('reports a structurally invalid rules document', () => {
    const result = validateConfigurationRelease(VALID_QUESTIONNAIRE, 'not json', STOCK_ITEMS);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Rules: /);
  });

  it('reports a rule referencing stock that is not currently active', () => {
    const result = validateConfigurationRelease(VALID_QUESTIONNAIRE, VALID_RULES, []);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Soap|Shampoo/);
  });
});
