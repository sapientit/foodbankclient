import { describe, expect, it } from 'vitest';
import type { OptionSources, ReferralFormDefinition } from './referral-form-definition';
import { buildReReferInitialAnswers, reReferPages, type ReReferSource } from './re-refer.logic';

const DEFINITION: ReferralFormDefinition = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Referrer and client details',
      questions: [
        {
          type: 'keyField',
          key: 'referrerName',
          label: "Referrer's name",
          required: true,
          field: 'referrerName',
        },
        {
          type: 'keyField',
          key: 'referrerEmail',
          label: "Referrer's email",
          required: true,
          field: 'referrerEmail',
        },
        {
          type: 'keyField',
          key: 'referrerOrganisation',
          label: "Referrer's organisation",
          required: true,
          field: 'referrerOrganisation',
        },
        {
          type: 'keyField',
          key: 'referrerPhone',
          label: "Referrer's phone",
          required: true,
          field: 'referrerPhone',
        },
        {
          type: 'keyField',
          key: 'refereeFirstName',
          label: "Client's first name",
          required: true,
          field: 'refereeFirstName',
        },
        {
          type: 'keyField',
          key: 'refereeSurname',
          label: "Client's surname",
          required: true,
          field: 'refereeSurname',
        },
        {
          type: 'keyField',
          key: 'sessionId',
          label: 'Session date',
          required: true,
          field: 'sessionId',
        },
        {
          type: 'keyField',
          key: 'reasonId',
          label: 'Main cause of crisis',
          required: true,
          field: 'reasonId',
        },
        {
          type: 'choice',
          key: 'Secondary',
          label: 'Secondary cause of crisis',
          required: false,
          preference: false,
          answerMin: 0,
          answerMax: 1,
          options: [],
          optionsFrom: 'referralReasons',
          maxAnswerLength: 100,
        },
        {
          type: 'choice',
          key: 'Collection method',
          label: 'How will the parcel be collected',
          required: true,
          preference: false,
          answerMin: 1,
          answerMax: 1,
          options: [
            { value: 'Car', label: 'Car' },
            { value: 'Public Transport', label: 'Public Transport' },
            { value: 'On Foot', label: 'On Foot' },
            { value: 'Referrer will collect', label: 'Referrer will collect' },
            { value: 'Delivery Requested', label: 'Delivery Requested' },
          ],
          maxAnswerLength: 100,
        },
      ],
    },
    {
      pageNum: 2,
      pageTitle: 'Preferences',
      questions: [
        {
          type: 'choice',
          key: 'Toiletries',
          label: 'Toiletries',
          required: false,
          preference: true,
          answerMin: 0,
          answerMax: 2,
          options: [
            { value: 'Soap', label: 'Soap' },
            { value: 'Shampoo', label: 'Shampoo' },
          ],
        },
        {
          type: 'text',
          key: 'Notes',
          label: 'Anything else',
          required: false,
          preference: false,
          maxLength: 500,
        },
      ],
    },
  ],
};

/** Page 1 is nothing but the referrer, so filtering must drop the whole page. */
const REFERRER_ONLY_PAGE_DEFINITION: ReferralFormDefinition = {
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Referrer',
      questions: [
        {
          type: 'keyField',
          key: 'referrerName',
          label: "Referrer's name",
          required: true,
          field: 'referrerName',
        },
      ],
    },
    DEFINITION.pages[1]!,
  ],
};

function source(overrides: Partial<ReReferSource> = {}): ReReferSource {
  return {
    answers: {},
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'GU23 4XX',
    refereePhone: '01483 123456',
    needsFuelHelp: false,
    reasonId: 'reason-debt',
    collectionMethod: 'collection',
    ...overrides,
  };
}

const ACTIVE_REASONS: OptionSources = {
  referralReasons: [
    { value: 'reason-debt', label: 'Debt' },
    { value: 'reason-illness', label: 'Illness' },
  ],
};

describe('reReferPages', () => {
  it('removes the referrer and session key fields, keeping the rest of the page', () => {
    const pages = reReferPages(DEFINITION);

    expect(
      pages[0]?.questions.map((question) =>
        question.type === 'information' ? null : question.key,
      ),
    ).toEqual(['refereeFirstName', 'refereeSurname', 'reasonId', 'Secondary', 'Collection method']);
    expect(
      pages[1]?.questions.map((question) =>
        question.type === 'information' ? null : question.key,
      ),
    ).toEqual(['Toiletries', 'Notes']);
  });

  it('drops a page left with nothing else on it', () => {
    const pages = reReferPages(REFERRER_ONLY_PAGE_DEFINITION);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageTitle).toBe('Preferences');
  });
});

describe('buildReReferInitialAnswers', () => {
  it('carries forward the fixed fields that cannot have changed', () => {
    const answers = buildReReferInitialAnswers(source(), DEFINITION, ACTIVE_REASONS);

    expect(answers.refereeFirstName).toBe('Jamie');
    expect(answers.refereeSurname).toBe('Rowe');
    expect(answers.reasonId).toBe('reason-debt');
  });

  it('leaves the reason blank once it has been retired', () => {
    const answers = buildReReferInitialAnswers(
      source({ reasonId: 'reason-retired' }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.reasonId).toBe('');
  });

  it('carries forward a dynamic choice answer that still names an active reason', () => {
    const answers = buildReReferInitialAnswers(
      source({ answers: { Secondary: 'reason-illness' } }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.Secondary).toEqual(['reason-illness']);
  });

  it('leaves a dynamic lookup-driven answer blank once its reason has been retired', () => {
    const answers = buildReReferInitialAnswers(
      source({ answers: { Secondary: 'reason-retired' } }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.Secondary).toEqual([]);
  });

  it('carries forward a plain choice answer that is still an offered option', () => {
    const answers = buildReReferInitialAnswers(
      source({ answers: { Toiletries: ['Soap'] } }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.Toiletries).toEqual(['Soap']);
  });

  it('leaves a plain choice answer blank once the option is no longer offered', () => {
    const answers = buildReReferInitialAnswers(
      source({ answers: { Toiletries: ['Marmite'] } }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.Toiletries).toEqual([]);
  });

  it('carries forward a plain text answer unconditionally', () => {
    const answers = buildReReferInitialAnswers(
      source({ answers: { Notes: 'Prefers tinned food.' } }),
      DEFINITION,
      ACTIVE_REASONS,
    );

    expect(answers.Notes).toBe('Prefers tinned food.');
  });

  it('leaves a question the household was never asked at its default, blank value', () => {
    const answers = buildReReferInitialAnswers(source(), DEFINITION, ACTIVE_REASONS);

    expect(answers.Notes).toBe('');
    expect(answers.Toiletries).toEqual([]);
  });

  describe('collection method', () => {
    // The normal case: `splitSubmission` now stores the answer itself
    // alongside the typed `collectionMethod` column, so it is carried
    // forward exactly like any other dynamic choice — "Car" included, which
    // the typed column alone could never have told apart from "Public
    // Transport" or "On Foot".
    it('carries forward the stored answer directly, once the referral has one', () => {
      const answers = buildReReferInitialAnswers(
        source({ answers: { 'Collection method': 'Car' }, collectionMethod: 'collection' }),
        DEFINITION,
        ACTIVE_REASONS,
      );

      expect(answers['Collection method']).toEqual(['Car']);
    });

    // Regression, and the legacy path: a referral submitted before
    // `splitSubmission` started storing this answer has nothing under
    // `source.answers['Collection method']` at all — `splitSubmission` used
    // to divert it into the typed `collectionMethod` column exclusively — so
    // this screen used to leave it blank on every re-refer regardless. Now
    // it reconstructs what it can from that column.
    it('falls back to the typed column for a referral with no stored answer: delivery', () => {
      const answers = buildReReferInitialAnswers(
        source({ collectionMethod: 'delivery' }),
        DEFINITION,
        ACTIVE_REASONS,
      );

      expect(answers['Collection method']).toEqual(['Delivery Requested']);
    });

    it('falls back to the typed column for a referral with no stored answer: referrer will collect', () => {
      const answers = buildReReferInitialAnswers(
        source({ collectionMethod: 'referrer_collect' }),
        DEFINITION,
        ACTIVE_REASONS,
      );

      expect(answers['Collection method']).toEqual(['Referrer will collect']);
    });

    // The one case the fallback cannot recover: "Car", "Public Transport"
    // and "On Foot" all collapsed into the same `'collection'` column on a
    // referral old enough to have no stored answer, so which of the three it
    // actually was is genuinely gone — left blank like any other answer with
    // no obvious match, same as a retired reason or a dropped preference
    // option.
    it('leaves a plain collection answer blank when falling back, since which option it was cannot be recovered', () => {
      const answers = buildReReferInitialAnswers(
        source({ collectionMethod: 'collection' }),
        DEFINITION,
        ACTIVE_REASONS,
      );

      expect(answers['Collection method']).toEqual([]);
    });
  });
});
