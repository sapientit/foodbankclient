import { describe, expect, it } from 'vitest';
import type {
  FormQuestion,
  KeyFieldName,
  ReferralFormDefinition,
} from './referral-form-definition';
import type { ReferralLookups } from './referral-lookups';
import {
  COLLECTION_METHOD_KEY,
  DELIVERY_REQUESTED,
  describeSubmission,
  preferenceQuestions,
  splitSubmission,
} from './referral-submission.logic';

function form(...questions: FormQuestion[]): ReferralFormDefinition {
  return { version: 1, pages: [{ pageNum: 1, pageTitle: 'Page', questions }] };
}

function keyField(field: KeyFieldName, required = true): FormQuestion {
  return { key: field, type: 'keyField', field, label: field, required };
}

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const REASON_ID = '00000000-0000-4000-8000-000000000002';

const lookups: ReferralLookups = {
  sessions: [
    {
      id: SESSION_ID,
      sessionDate: '2026-08-11',
      startTime: '10:00',
      deliveriesAllowed: true,
    },
  ],
  referralReasons: [{ id: REASON_ID, label: 'Low income' }],
};

/** Neither list arrived. The fallback path, not the normal one. */
const noLookups: ReferralLookups = { sessions: [], referralReasons: [] };

describe('splitSubmission', () => {
  it('puts key fields at the top level and everything else in the answers bag', () => {
    const definition = form(keyField('refereeFirstName'), keyField('adults'), {
      key: 'Dietary',
      type: 'text',
      label: 'Dietary',
      required: false,
      preference: true,
      maxLength: 100,
    });

    expect(
      splitSubmission(definition, {
        refereeFirstName: 'Jane',
        adults: '2',
        Dietary: 'No nuts',
      }),
    ).toEqual({
      keyFields: { refereeFirstName: 'Jane', adults: 2 },
      answers: { Dietary: 'No nuts' },
    });
  });

  it('sends a count as a real number and a yes/no field as a boolean', () => {
    const result = splitSubmission(form(keyField('adults'), keyField('isDelivery', false)), {
      adults: '3',
      isDelivery: 'Yes',
    });

    expect(result.keyFields).toEqual({ adults: 3, isDelivery: true });
    expect(typeof result.keyFields.adults).toBe('number');
  });

  it('sends an unticked yes/no field as false, not as an omission', () => {
    // `isDelivery` has a default of `false` on the server, but sending it
    // explicitly is what makes the referral say the client is collecting
    // rather than say nothing at all.
    const result = splitSubmission(form(keyField('isDelivery', false)), { isDelivery: '' });
    expect(result.keyFields).toEqual({ isDelivery: false });
  });

  it('derives the delivery flag from the collection-method answer', () => {
    const collectionMethod: FormQuestion = {
      key: COLLECTION_METHOD_KEY,
      type: 'choice',
      label: 'Collection method',
      required: true,
      preference: false,
      answerMin: 1,
      answerMax: 1,
      options: [
        { value: 'Car', label: 'Car' },
        { value: DELIVERY_REQUESTED, label: DELIVERY_REQUESTED },
      ],
    };

    expect(
      splitSubmission(form(collectionMethod), { [COLLECTION_METHOD_KEY]: [DELIVERY_REQUESTED] }),
    ).toEqual({
      keyFields: { isDelivery: true },
      answers: { [COLLECTION_METHOD_KEY]: DELIVERY_REQUESTED },
    });
    expect(
      splitSubmission(form(collectionMethod), { [COLLECTION_METHOD_KEY]: ['Car'] }).keyFields,
    ).toEqual({ isDelivery: false });
  });

  it('omits an optional phone left blank rather than storing an empty string', () => {
    const result = splitSubmission(form(keyField('refereePhone', false)), { refereePhone: '  ' });
    expect(result.keyFields).toEqual({});
  });

  it('formats the postcode on the way out, because it is searched on', () => {
    const result = splitSubmission(form(keyField('refereePostcode')), {
      refereePostcode: ' gu234xx ',
    });
    expect(result.keyFields.refereePostcode).toBe('GU23 4XX');
  });

  it('omits an unanswered optional question rather than sending an empty string', () => {
    const definition = form({
      key: 'Dietary',
      type: 'text',
      label: 'Dietary',
      required: false,
      preference: true,
      maxLength: 100,
    });

    expect(splitSubmission(definition, { Dietary: '   ' }).answers).toEqual({});
  });

  it('records nothing at all for a choice left on None', () => {
    // `referral details.txt`: "None is also not recorded as a value." A stored
    // empty list would read back as a household that answered "nothing", which
    // is a different thing from one that was never asked.
    const definition = form({
      key: 'Eggs',
      type: 'choice',
      label: 'Eggs?',
      required: false,
      preference: true,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
    });

    expect(splitSubmission(definition, { Eggs: [] }).answers).toEqual({});
  });

  it('stores a one-answer choice as the bare value, not a list of one', () => {
    // `referral details.txt`: "there will be an eggs: 'Yes' entry."
    const definition = form({
      key: 'Eggs',
      type: 'choice',
      label: 'Eggs?',
      required: false,
      preference: true,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
    });

    expect(splitSubmission(definition, { Eggs: ['Yes'] }).answers).toEqual({ Eggs: 'Yes' });
  });

  it('stores a multi-answer choice as a list', () => {
    const definition = form({
      key: 'Toiletries',
      type: 'choice',
      label: 'Toiletries',
      required: false,
      preference: true,
      answerMin: 0,
      answerMax: 3,
      options: ['A', 'B'].map((value) => ({ value, label: value })),
    });

    expect(splitSubmission(definition, { Toiletries: ['A', 'B'] }).answers).toEqual({
      Toiletries: ['A', 'B'],
    });
  });

  it('sends a number answer as a real number, not the text it was typed as', () => {
    const definition = form({
      key: 'Child 0-2',
      type: 'number',
      label: 'Children aged 0-2',
      required: false,
      preference: false,
    });

    const { answers } = splitSubmission(definition, { 'Child 0-2': '3' });
    expect(answers).toEqual({ 'Child 0-2': 3 });
    expect(typeof answers['Child 0-2']).toBe('number');
  });

  it('drops a greyed-out question whatever it happens to be holding', () => {
    // The second lock on the same door as `clearDisabledAnswers`. The cost of
    // being wrong is a claim about somebody's gas meter that nobody made.
    const definition = form(keyField('needsFuelHelp', false), {
      key: 'Pre-Payment',
      type: 'choice',
      label: 'Pre-payment meter?',
      required: false,
      preference: false,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
      enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
    });

    expect(splitSubmission(definition, { needsFuelHelp: '', 'Pre-Payment': ['Yes'] })).toEqual({
      keyFields: { needsFuelHelp: false },
      answers: {},
    });
  });

  it('keeps a conditional answer once its question is enabled', () => {
    const definition = form(keyField('needsFuelHelp', false), {
      key: 'Pre-Payment',
      type: 'choice',
      label: 'Pre-payment meter?',
      required: false,
      preference: false,
      answerMin: 0,
      answerMax: 1,
      options: [{ value: 'Yes', label: 'Yes' }],
      enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
    });

    expect(splitSubmission(definition, { needsFuelHelp: 'Yes', 'Pre-Payment': ['Yes'] })).toEqual({
      keyFields: { needsFuelHelp: true },
      answers: { 'Pre-Payment': 'Yes' },
    });
  });
});

/**
 * One female and one male in all five age bands. The same ten people are
 * counted two different ways on purpose: the payload carries the pair that
 * indexes the household grid, the confirmation carries the pair a referrer
 * would recognise as their household.
 */
const TEN_PEOPLE = {
  '0-4': { female: 1, male: 1 },
  '5-11': { female: 1, male: 1 },
  '12-17': { female: 1, male: 1 },
  'working-age': { female: 1, male: 1 },
  'state-pension-age': { female: 1, male: 1 },
};

const compositionQuestion: FormQuestion = {
  key: 'Household Components',
  type: 'householdComposition',
  label: 'Who lives in the household',
  required: true,
  preference: false,
};

describe('the two household derivations', () => {
  it('sends the operational pair with the referral, not the everyday one', () => {
    const { keyFields } = splitSubmission(form(compositionQuestion), {
      'Household Components': TEN_PEOPLE,
    });

    expect(keyFields).toMatchObject({ adults: 6, children: 2 });
  });

  it('reads the household back to the referrer in the everyday sense of the words', () => {
    // A referrer has just typed this grid in and is checking it is the right
    // household. "6 adults, 2 children" is true of the parcel and false of the
    // people, and this page is about the people.
    expect(
      describeSubmission(
        form(compositionQuestion),
        { 'Household Components': TEN_PEOPLE },
        lookups,
      ),
    ).toEqual([{ label: 'Who lives in the household', value: '4 adults, 6 children' }]);
  });
});

describe('describeSubmission', () => {
  it('shows the mandatory answers back, which is a referrer’s only chance to spot a mistake', () => {
    // There is no amending after this — `screenDetails.md`, "After a referral
    // is submitted".
    const definition = form(keyField('refereeSurname'), {
      key: 'Dietary',
      type: 'text',
      label: 'Dietary',
      required: false,
      preference: true,
      maxLength: 100,
    });

    expect(
      describeSubmission(definition, { refereeSurname: 'Robinson', Dietary: 'No nuts' }, lookups),
    ).toEqual([{ label: 'refereeSurname', value: 'Robinson' }]);
  });

  /**
   * The session and the reason are the two answers a referrer cannot check
   * against an id, and checking is the only thing this screen is for.
   */
  it('shows the session and the reason as words, never as the ids that were sent', () => {
    const definition = form(keyField('sessionId'), keyField('reasonId'));

    const lines = describeSubmission(
      definition,
      { sessionId: SESSION_ID, reasonId: REASON_ID },
      lookups,
    );

    expect(lines).toEqual([
      { label: 'sessionId', value: 'Tue, 11 Aug 2026 at 10:00' },
      { label: 'reasonId', value: 'Low income' },
    ]);
    expect(JSON.stringify(lines)).not.toContain(SESSION_ID);
    expect(JSON.stringify(lines)).not.toContain(REASON_ID);
  });

  it('falls back to what was sent if a lookup is unexpectedly unavailable', () => {
    // Not the normal path and not worth a blank line where the session should
    // be: something unhelpful still tells them to ring.
    const definition = form(keyField('sessionId'));

    expect(describeSubmission(definition, { sessionId: SESSION_ID }, noLookups)).toEqual([
      { label: 'sessionId', value: SESSION_ID },
    ]);
  });

  it('leaves out a mandatory question that is greyed out', () => {
    const definition = form(keyField('needsFuelHelp', false), {
      key: 'Pre-Payment',
      type: 'text',
      label: 'Pre-payment meter?',
      required: true,
      preference: false,
      maxLength: 10,
      enabledWhen: { questionKey: 'needsFuelHelp', hasAnswer: 'Yes' },
    });

    expect(
      describeSubmission(definition, { needsFuelHelp: '', 'Pre-Payment': 'Yes' }, lookups),
    ).toEqual([]);
  });
});

describe('preferenceQuestions', () => {
  it('names only the preference questions, in the order the form asks them', () => {
    const definition = form(
      keyField('adults'),
      {
        key: 'Cause Details',
        type: 'text',
        label: 'Cause',
        required: false,
        preference: false,
        maxLength: 10,
      },
      {
        key: 'Dietary',
        type: 'text',
        label: 'Dietary',
        required: false,
        preference: true,
        maxLength: 10,
      },
      {
        key: 'Other',
        type: 'text',
        label: 'Other',
        required: false,
        preference: true,
        maxLength: 10,
      },
    );

    expect(preferenceQuestions(definition).map((question) => question.key)).toEqual([
      'Dietary',
      'Other',
    ]);
  });
});
