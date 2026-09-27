import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import { addCalendarDays, londonToday } from '../../../lib/london-time';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/**
 * A week out from whenever the suite runs — the session picker only offers
 * sessions from today onwards that are not closed
 * (`session-list-filters.logic.ts`), so a fixed calendar date would stop
 * appearing in it once real time passed it by.
 */
const FUTURE_SESSION_DATE = addCalendarDays(londonToday(), 7);

/**
 * "Copy this referral" once the referral form has changed since the source
 * was answered — `screenDetails.md`, "Copying a referral", and
 * `docs/planning/versioned-configuration-releases.md`, "Copying a referral
 * (admin only)". A deliberately minimal questionnaire: the real shipped form
 * is exercised by `public-referral-screen.test.tsx`, and this file is about
 * the review-and-submit behaviour, not the charity's real questions.
 */

const REFRESH = '/api/v1/auth/refresh';
const REFERRAL = '/api/v1/referrals/r1';
const SESSIONS = '/api/v1/sessions';
const REASONS = '/api/v1/referral-reasons';
const QUESTIONNAIRE = '/api/v1/public/questionnaire';
const RE_REFER = '/api/v1/referrals/r1/re-refer';

const QUESTIONNAIRE_JSON = JSON.stringify({
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Referrer and client details',
      questions: [
        {
          questionNum: 1,
          questionKey: 'referrerName',
          questionTitle: "Referrer's name",
          keyField: 'referrerName',
          required: true,
        },
        {
          questionNum: 2,
          questionKey: 'referrerEmail',
          questionTitle: "Referrer's email",
          keyField: 'referrerEmail',
          required: true,
        },
        {
          questionNum: 3,
          questionKey: 'referrerOrganisation',
          questionTitle: "Referrer's organisation",
          keyField: 'referrerOrganisation',
          required: true,
        },
        {
          questionNum: 4,
          questionKey: 'referrerPhone',
          questionTitle: "Referrer's phone",
          keyField: 'referrerPhone',
          required: true,
        },
        {
          questionNum: 5,
          questionKey: 'refereeFirstName',
          questionTitle: "Client's first name",
          keyField: 'refereeFirstName',
          required: true,
        },
        {
          questionNum: 6,
          questionKey: 'refereeSurname',
          questionTitle: "Client's surname",
          keyField: 'refereeSurname',
          required: true,
        },
        {
          questionNum: 7,
          questionKey: 'refereeDateOfBirth',
          questionTitle: "Client's date of birth",
          keyField: 'refereeDateOfBirth',
          required: true,
        },
        {
          questionNum: 8,
          questionKey: 'refereeAddress',
          questionTitle: "Client's address",
          keyField: 'refereeAddress',
          required: true,
        },
        {
          questionNum: 9,
          questionKey: 'refereePostcode',
          questionTitle: "Client's postcode",
          keyField: 'refereePostcode',
          required: true,
        },
        {
          questionNum: 10,
          questionKey: 'Household Components',
          questionTitle: 'Household',
          preference: false,
          required: true,
          validation: { type: 'HouseholdComposition' },
        },
        {
          questionNum: 11,
          questionKey: 'Collection method',
          questionTitle: 'How will the parcel be collected?',
          preference: false,
          required: true,
          validation: { type: 'CheckBox', answerMin: 1, answerMax: 1 },
          answers: ['Car', 'Delivery Requested', 'Referrer will collect'],
        },
        {
          questionNum: 12,
          questionKey: 'reasonId',
          questionTitle: 'Main cause of crisis',
          keyField: 'reasonId',
          required: true,
        },
      ],
    },
    {
      pageNum: 2,
      pageTitle: 'Preferences',
      questions: [
        {
          questionNum: 1,
          questionKey: 'Toiletries',
          questionTitle: 'Toiletries',
          preference: true,
          required: false,
          validation: { type: 'CheckBox', answerMin: 0, answerMax: 1 },
          answers: ['Soap'],
        },
      ],
    },
  ],
});

function referral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's-old',
    status: 'reviewed',
    outcome: 'attended',
    referredAt: '2026-01-01T10:00:00.000Z',
    adults: 2,
    children: 0,
    householdSize: 2,
    isDelivery: false,
    collectionMethod: 'collection',
    needsFuelHelp: false,
    referrerOrganisation: 'Riverside Church',
    referrerName: 'Sam Referrer',
    referrerEmail: 'sam@riverside.org',
    referrerPhone: '01483 000000',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'GU23 4XX',
    refereePhone: null,
    answers: {},
    piiPurgedAt: null,
    formId: 'form-old',
    reasonId: 'q1',
    reviewComment: null,
    repeatReferrals: { count: 0, mostRecentSessionDate: null },
    ...overrides,
  };
}

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: FUTURE_SESSION_DATE,
    startTime: '10:00',
    startsAtUtc: `${FUTURE_SESSION_DATE}T09:00:00.000Z`,
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    deliveryCapacity: 0,
    deliveryBooked: 0,
    capacity: 25,
    booked: 10,
    status: 'planned',
    cancelledReason: null,
    isCustomised: false,
    recurringSessionId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

async function fillHouseholdComposition(user: ReturnType<typeof userEvent.setup>) {
  const adultFemale = screen.getByLabelText('18 to State Pension age, Female');
  await user.clear(adultFemale);
  await user.type(adultFemale, '2');
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
    http.get(QUESTIONNAIRE, () =>
      HttpResponse.json({ formId: 'form-current', questionnaire: QUESTIONNAIRE_JSON }),
    ),
    http.get(SESSIONS, () =>
      HttpResponse.json({ sessions: [session({ id: 's1' }), session({ id: 's-old' })] }),
    ),
    http.get(REASONS, () =>
      HttpResponse.json({
        referralReasons: [
          {
            id: 'q1',
            code: 'financial_hardship',
            label: 'Financial hardship',
            displayOrder: 0,
            isActive: true,
          },
        ],
      }),
    ),
  );
});

describe('reviewing a referral onto today’s form', () => {
  it('pre-fills what cannot have changed and shows the referrer read-only, never as an editable field', async () => {
    renderApp('/referrals/r1/re-refer');

    // Not `findByRole('heading', ...)`: the heading appears in the loading
    // state too, before the active release and sessions/reasons have
    // resolved, so it proves nothing about the rest of the page being ready.
    await screen.findByText(/made on an earlier version of this form/);

    // Read-only context, not an editable question.
    expect(screen.getByText('Referred by')).toBeInTheDocument();
    expect(screen.getByText(/Sam Referrer, Riverside Church/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Referrer's name/)).toBeNull();
    expect(screen.queryByLabelText(/Referrer's email/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Session/ })).toBeNull();

    // Pre-filled from the source referral.
    expect(screen.getByLabelText(/Client's first name/)).toHaveValue('Jamie');
    expect(screen.getByLabelText(/Client's surname/)).toHaveValue('Rowe');
    expect(screen.getByLabelText(/Client's address/)).toHaveValue('1 Elm Street');
  });

  it('submits the reviewed form to re-refer, never to copy, with no referrer field and no formId', async () => {
    let submittedBody: unknown = null;
    let reReferred = false;
    server.use(
      http.post(RE_REFER, async ({ request }) => {
        submittedBody = await request.json();
        reReferred = true;
        return HttpResponse.json(referral({ id: 'r2', formId: 'form-current' }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderApp('/referrals/r1/re-refer');

    await screen.findByLabelText(/Client's first name/);
    await fillHouseholdComposition(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Car',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /Main cause of crisis/ }), 'q1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText(/Page 2 of 2/);
    await user.click(screen.getByRole('button', { name: 'Submit this referral' }));

    expect(await screen.findByText('Choose a session for this referral.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Choose session'), 's1');
    await user.click(screen.getByRole('button', { name: 'Submit this referral' }));

    await waitFor(() => {
      expect(reReferred).toBe(true);
    });

    expect(submittedBody).toMatchObject({
      sessionId: 's1',
      reasonId: 'q1',
      refereeFirstName: 'Jamie',
      refereeSurname: 'Rowe',
      refereeAddress: '1 Elm Street',
      collectionMethod: 'collection',
    });
    expect(submittedBody).not.toHaveProperty('formId');
    expect(submittedBody).not.toHaveProperty('referrerName');
    expect(submittedBody).not.toHaveProperty('referrerEmail');
  });

  it('never offers a closed or already-past session in the review-and-submit picker', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({ id: 's1', booked: 3, capacity: 10 }),
            session({ id: 's-confirmed', status: 'confirmed', booked: 5, capacity: 20 }),
            session({
              id: 's-past',
              sessionDate: addCalendarDays(londonToday(), -1),
              startsAtUtc: `${addCalendarDays(londonToday(), -1)}T09:00:00.000Z`,
              booked: 7,
              capacity: 30,
            }),
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderApp('/referrals/r1/re-refer');

    await screen.findByLabelText(/Client's first name/);
    await fillHouseholdComposition(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Car',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /Main cause of crisis/ }), 'q1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText(/Page 2 of 2/);
    await user.click(screen.getByRole('button', { name: 'Submit this referral' }));

    await screen.findByRole('option', { name: /3 of 10 booked/ });
    expect(screen.queryByRole('option', { name: /5 of 20 booked/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /7 of 30 booked/ })).toBeNull();
  });

  it('is not offered for a referral that can still be completed', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'active', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1/re-refer');

    expect(await screen.findByText(/should be moved rather than copied/)).toBeInTheDocument();
  });
});
