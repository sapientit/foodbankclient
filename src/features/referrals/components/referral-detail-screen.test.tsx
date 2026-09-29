import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import { addCalendarDays, londonToday } from '../../../lib/london-time';
import type { ConfigurationRelease } from '../../configuration-releases/queries';
import rawFormConfig from '../referral-form.config.json';
import type { AdminReferralReason } from '../../admin-setup/queries';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/**
 * A week out from whenever the suite runs, never a fixed calendar date — a
 * session fixture the move/copy picker offers has to stay open (today
 * onwards, not closed; `session-list-filters.logic.ts`) for as long as this
 * suite exists, not just on the day it was written.
 */
const FUTURE_SESSION_DATE = addCalendarDays(londonToday(), 7);

/**
 * Signed in as Pete, an administrator — see `test/render-app.tsx`. The
 * team-lead view of this same screen is `referral-detail-team-lead.test.tsx`,
 * its own file because `renderApp`'s signed-in actor is fixed per module.
 */
const REFRESH = '/api/v1/auth/refresh';
const REFERRAL = '/api/v1/referrals/r1';
const REFERRAL_CANCEL = '/api/v1/referrals/r1/cancel';
const REFERRAL_ACCEPT = '/api/v1/referrals/r1/accept';
const REFERRAL_REJECT = '/api/v1/referrals/r1/reject';
const REFERRAL_REVIEW = '/api/v1/referrals/r1/review';
const REFERRAL_COPY = '/api/v1/referrals/r1/copy';
const REPEAT_REFERRALS = '/api/v1/referrals/r1/repeat-referrals';
const SESSIONS = '/api/v1/sessions';
const REASONS = '/api/v1/referral-reasons';
const RELEASES_BULK = '/api/v1/configuration-releases/bulk';
const QUESTIONNAIRE = '/api/v1/public/questionnaire';

/**
 * Every referral fixture below carries this `formId`, and this is the release
 * the detail screen resolves it against — the shipped
 * `referral-form.config.json` verbatim, so every question label and key this
 * file already asserts on stays true, exactly as `public-referral-screen`'s
 * own test does for the same reason.
 */
const FORM_ID = 'form-1';

const RELEASE: ConfigurationRelease = {
  formId: FORM_ID,
  status: 'published',
  questionnaireHash: 'hash',
  rulesHash: 'hash',
  generationId: 'gen-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceWorkbookId: 'workbook-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdByUserId: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
  publishedByUserId: null,
  questionnaire: JSON.stringify(rawFormConfig),
};

function referral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 2,
    children: 1,
    householdSize: 3,
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
    formId: FORM_ID,
    reasonId: 'q1',
    referrerEmail: 'referrer@riverside.org',
    referrerPhone: null,
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

const REASON: AdminReferralReason = {
  id: 'q1',
  code: 'financial_hardship',
  label: 'Financial hardship',
  displayOrder: 0,
  isActive: true,
};

/** Stubbed in `test/setup.ts` as a tab that opened; the blocked case sets `null` itself. */
let openTab: MockInstance<typeof window.open>;

beforeEach(() => {
  // The spy `test/setup.ts` installed; spying again returns it, implementation intact.
  openTab = vi.spyOn(window, 'open');
});

/** The one compose URL a test opened, as its query parameters. */
function openedComposeParams(): URLSearchParams {
  expect(openTab).toHaveBeenCalledTimes(1);
  const [url] = openTab.mock.calls[0] ?? [];
  expect(typeof url).toBe('string');
  return new URL(String(url)).searchParams;
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
    http.get(REASONS, () => HttpResponse.json({ referralReasons: [REASON] })),
    http.get(SESSIONS, () =>
      HttpResponse.json({
        sessions: [
          session({ id: 's1', location: 'Church Hall' }),
          session({ id: 's2', location: 'Community Centre', booked: 25, capacity: 25 }),
        ],
      }),
    ),
    http.get(RELEASES_BULK, () => HttpResponse.json({ releases: [RELEASE] })),
    // The active release, for the Copy button's same-form-or-review split.
    // Matches `FORM_ID` by default, so a referral's own release is the active
    // one unless a test deliberately publishes a different one.
    http.get(QUESTIONNAIRE, () =>
      HttpResponse.json({ formId: FORM_ID, questionnaire: JSON.stringify(rawFormConfig) }),
    ),
  );
});

describe('the admin referral detail screen', () => {
  it('opens previous attendance automatically when an outstanding review has possible matches', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'unreviewed', previousSessionDate: null },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () =>
        HttpResponse.json({
          count: 1,
          mostRecentSessionDate: '2026-06-14',
          matches: [
            {
              referralId: 'old-attended',
              sessionId: 'old-session-1',
              sessionDate: '2026-06-14',
              outcome: 'attended',
              matchedOn: ['postcode'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
          ],
        }),
      ),
    );
    renderApp('/referrals/r1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Potential matches' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review first-time status' })).toBeNull();
  });

  it('returns to the referral list when Back leaves a mandatory previous-attendance decision', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'unreviewed', previousSessionDate: null },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () =>
        HttpResponse.json({
          count: 1,
          mostRecentSessionDate: '2026-06-14',
          matches: [],
        }),
      ),
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
    );

    renderApp('/referrals/r1/first-time-review');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Back' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check referrals' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Potential matches' })).toBeNull();
  });

  it('records no previous attendance automatically when there are no possible matches', async () => {
    let saved: unknown;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'unreviewed', previousSessionDate: null },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () =>
        HttpResponse.json({ count: 0, mostRecentSessionDate: null, matches: [] }),
      ),
      http.post('/api/v1/referrals/r1/first-time-review', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'no_previous_referral', previousSessionDate: null },
          }),
        );
      }),
    );

    renderApp('/referrals/r1');
    await waitFor(() => {
      expect(saved).toEqual({ noPreviousReferral: true });
    });
    expect(screen.getByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Potential matches' })).toBeNull();
  });

  it('records a selectable earlier session and leaves a no-show visible but unavailable', async () => {
    let saved: unknown;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'unreviewed', previousSessionDate: null },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () =>
        HttpResponse.json({
          count: 2,
          mostRecentSessionDate: '2026-06-14',
          matches: [
            {
              referralId: 'old-attended',
              sessionId: 'old-session-1',
              sessionDate: '2026-06-14',
              outcome: 'attended',
              matchedOn: ['postcode'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
            {
              referralId: 'old-no-show',
              sessionId: 'old-session-2',
              sessionDate: '2026-06-07',
              outcome: 'no_show',
              matchedOn: ['postcode'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
          ],
        }),
      ),
      http.post('/api/v1/referrals/r1/first-time-review', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(
          referral({
            id: 'r1',
            firstTimeReview: { status: 'previous_session', previousSessionDate: '2026-06-14' },
          }),
        );
      }),
    );

    renderApp('/referrals/r1/first-time-review');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Potential matches' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Referral being submitted' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Surname starts with' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Exclude postcode matches' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Last attended');
    expect(screen.getByRole('heading', { name: 'Referral check' })).toBeInTheDocument();
    const [available, unavailable] = await screen.findAllByRole('radio', {
      name: 'Select Jamie Rowe',
    });
    if (available === undefined || unavailable === undefined)
      throw new Error('Expected both matches.');
    expect(unavailable).toBeDisabled();
    await user.click(available);
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    await waitFor(() => {
      expect(saved).toEqual({ previousSessionDate: '2026-06-14' });
    });
  });

  it('returns to the referral with a previous-referrals summary and revisit link after saving', async () => {
    let saved: unknown;
    let storedReferral = referral({
      id: 'r1',
      firstTimeReview: { status: 'unreviewed', previousSessionDate: null },
      repeatReferrals: { count: 3, mostRecentSessionDate: '2026-06-14' },
    });
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(storedReferral)),
      http.get(REPEAT_REFERRALS, () =>
        HttpResponse.json({
          count: 3,
          mostRecentSessionDate: '2026-06-14',
          matches: [
            {
              referralId: 'old-attended',
              sessionId: 'old-session-1',
              sessionDate: '2026-06-14',
              outcome: 'attended',
              matchedOn: ['postcode'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
          ],
        }),
      ),
      http.post('/api/v1/referrals/r1/first-time-review', async ({ request }) => {
        saved = await request.json();
        storedReferral = referral({
          id: 'r1',
          firstTimeReview: { status: 'previous_session', previousSessionDate: '2026-06-14' },
          repeatReferrals: { count: 3, mostRecentSessionDate: '2026-06-14' },
        });
        return HttpResponse.json(storedReferral);
      }),
    );

    renderApp('/referrals/r1/first-time-review');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Select Jamie Rowe' }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    await waitFor(() => {
      expect(saved).toEqual({ previousSessionDate: '2026-06-14' });
    });
    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    expect(screen.getByText(/3 previous possible referrals/)).toBeInTheDocument();
    const revisit = screen.getByRole('link', { name: 'Review previous attendance' });
    expect(revisit).toHaveAttribute('href', '/referrals/r1/first-time-review');

    await user.click(revisit);
    expect(
      await screen.findByText(
        'This referral’s previous-attendance decision has already been recorded.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to referral' }));
    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
  });

  it('marks an active referral reviewed from one button, beside the other actions', async () => {
    let reviews = 0;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'active' }))),
      http.post(REFERRAL_REVIEW, ({ request }) => {
        reviews += 1;
        expect(request.headers.get('content-type')).toBeNull();
        return HttpResponse.json(referral({ id: 'r1', status: 'reviewed' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    // One button, not one at each end of the page.
    const markReviewed = await screen.findByRole('button', { name: 'Mark reviewed' });
    expect(markReviewed.parentElement).toBe(
      screen.getByRole('button', { name: 'Cancel this referral' }).parentElement,
    );
    await user.click(markReviewed);

    await waitFor(() => {
      expect(reviews).toBe(1);
    });
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
  });

  it('renders the fixed fields, the reason (admin only) and the referrer email (admin only)', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    expect(screen.getByText('referrer@riverside.org')).toBeInTheDocument();
    expect(screen.getByText('Riverside Church')).toBeInTheDocument();
    expect(await screen.findByText('Financial hardship')).toBeInTheDocument();
  });

  it('labels the household counts with the ages they actually cover', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');

    // An administrator corrects these two numbers, so the screen has to say what
    // they count. Bare "Adults" would read as everyone over 18, which is not
    // what sizes the parcel and not what a correction should be typed against.
    expect(await screen.findByText('Adults (>11)')).toBeInTheDocument();
    expect(screen.getByText('Children (5-11)')).toBeInTheDocument();
    expect(screen.queryByText('Adults', { exact: true })).toBeNull();
  });

  it('shows the compact household composition grid for an administrator', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: { 'Household Components': { '0-4': { male: 1 } } },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    const grid = await screen.findByRole('table', { name: 'Household composition' });
    expect(within(grid).getByText('1')).toBeInTheDocument();
    expect(within(grid).getByText('0–4, Male:', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Generated')).toBeNull();
  });

  it('shows the collection method once, under its fixed label, not again in the generic answers list', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            collectionMethod: 'collection',
            answers: { 'Collection method': 'On Foot' },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Answers from the referral form' });
    expect(screen.getByText('Collection method')).toBeInTheDocument();
    expect(screen.getByText('Collection')).toBeInTheDocument();
    expect(screen.queryByText('How will the parcel be collected')).toBeNull();
    expect(screen.queryByText('On Foot')).toBeNull();
  });

  it('prefills stored page-one answers in their editing controls', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: {
              gender: 'Female',
              ethnicity: 'White -British',
              languages: 'English',
              'Household Components': { '0-4': { male: 1 }, 'working-age': { female: 1 } },
              'Collection method': 'On Foot',
            },
          }),
        ),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Referrer and client details' }));

    expect(await screen.findByLabelText("Client's gender")).toHaveValue('Female');
    // Regression: the stored answer used to never reach here — `splitSubmission`
    // diverted it into the typed `collectionMethod` column only, so this
    // control always opened on "-- choose --" regardless of what the
    // household had actually said.
    expect(screen.getByLabelText('How will the parcel be collected')).toHaveValue('On Foot');
    await user.clear(screen.getByLabelText('0–4, Male'));
    await user.type(screen.getByLabelText('0–4, Male'), '2');
    await user.selectOptions(
      screen.getByLabelText('How will the parcel be collected'),
      'Delivery Requested',
    );
    // Both confirmations, which is what the question now takes. The delivery
    // window line above them does not render here: the admin edit passes no
    // sessions to resolve `$deliveryTime` against, so the row hides rather than
    // printing the token.
    await user.click(
      screen.getByRole('checkbox', { name: 'The client meets the criteria for delivery' }),
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'The client will be in at the above time',
      }),
    );
    const surname = screen.getByLabelText(/Client.s surname/i);
    await user.clear(surname);
    await user.type(surname, 'Rowe-Smith');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({
        refereeSurname: 'Rowe-Smith',
        // Two under-fives and one working-age adult: the operational pair the
        // grid is indexed by, so the under-fives count towards neither number.
        adults: 1,
        children: 0,
        collectionMethod: 'delivery',
        answers: {
          gender: 'Female',
          ethnicity: 'White -British',
          languages: 'English',
          'Household Components': { '0-4': { male: 2 }, 'working-age': { female: 1 } },
          // Regression: saving used to delete this key rather than update it,
          // because `splitSubmission` never put an answer here for the save
          // path to find.
          'Collection method': 'Delivery Requested',
          // An array, not a bare value: the question now takes two answers, and
          // a multi-answer choice stores a list even when it is fully ticked.
          deliveryConfirm: [
            'The client meets the criteria for delivery',
            'The client will be in at the above time',
          ],
        },
      });
    });
  });

  it('edits administrator notes separately from the form answers', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', adminInfo: 'Ring after 2pm' })),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', adminInfo: 'Use side entrance' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByText('Ring after 2pm');
    await user.click(screen.getByRole('button', { name: 'Edit administrator notes' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit administrator notes' }));
    const input = dialog.getByLabelText('Administrator notes');
    await user.clear(input);
    await user.type(input, 'Use side entrance');
    await user.click(dialog.getByRole('button', { name: 'Save administrator notes' }));
    await waitFor(() => {
      expect(receivedBody).toEqual({ adminInfo: 'Use side entrance' });
    });
  });

  it('reads an answer chosen from the reason lookup as the words, never its id', async () => {
    // The secondary cause of crisis picks from the same maintained list as the
    // main one, so it is stored as the reason's id. An administrator reads it
    // through the admin list, which names retired reasons too.
    server.use(
      http.get(REASONS, () =>
        HttpResponse.json({
          referralReasons: [REASON, { ...REASON, id: 'q2', code: 'debt', label: 'Debt' }],
        }),
      ),
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', answers: { Secondary: 'q2' } })),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Debt')).toBeInTheDocument();
    expect(screen.queryByText('q2')).toBeNull();
  });

  it('shows a known answer by its label and an unknown key still, flagged as older', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: { Allergies: 'Nut allergy', legacyQuestion: 'some old answer' },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Nut allergy')).toBeInTheDocument();
    expect(screen.getByText(/cannot eat certain foods/)).toBeInTheDocument();
    expect(screen.getByText('legacyQuestion')).toBeInTheDocument();
    expect(screen.getByText('some old answer')).toBeInTheDocument();
    expect(screen.getByText('(no longer on the form)')).toBeInTheDocument();
  });

  it("renders answers against the release named by the referral's own formId, never the default one this file mocks", async () => {
    // A deliberately different release from `RELEASE` (which every other
    // fixture in this file resolves to): if the screen ever fell back to
    // "whichever release this file happens to mock" instead of asking for
    // `referral.formId` specifically, this key would not be recognised at
    // all — it does not exist in `RELEASE` — and would render under its raw
    // name instead of this label.
    const OTHER_FORM_ID = 'form-2';
    const otherRelease: ConfigurationRelease = {
      ...RELEASE,
      formId: OTHER_FORM_ID,
      questionnaire: JSON.stringify({
        version: 1,
        pages: [
          {
            pageNum: 1,
            pageTitle: 'Preferences',
            questions: [
              {
                questionNum: 1,
                questionKey: 'ShoeSize',
                questionTitle: 'What shoe size do they take?',
                preference: true,
                required: false,
                validation: { type: 'CheckBox', answerMin: 0, answerMax: 1 },
                answers: ['Size 8'],
              },
            ],
          },
        ],
      }),
    };
    let requestedFormIds: string | null = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({ id: 'r1', formId: OTHER_FORM_ID, answers: { ShoeSize: 'Size 8' } }),
        ),
      ),
      http.get(RELEASES_BULK, ({ request }) => {
        requestedFormIds = new URL(request.url).searchParams.get('formIds');
        return HttpResponse.json({ releases: [otherRelease] });
      }),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('What shoe size do they take?')).toBeInTheDocument();
    expect(screen.getByText('Size 8')).toBeInTheDocument();
    expect(requestedFormIds).toBe(OTHER_FORM_ID);
  });

  it('falls back to the raw-key rendering, and offers no page-editor, for a referral with no known release', async () => {
    let releasesRequested = false;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({ id: 'r1', formId: null, answers: { Allergies: 'Nut allergy' } }),
        ),
      ),
      http.get(RELEASES_BULK, () => {
        releasesRequested = true;
        return HttpResponse.json({ releases: [] });
      }),
    );

    renderApp('/referrals/r1');

    // The genuinely-unknown-structure fallback: every stored key renders
    // under its own name, the same path an unrecognised legacy key already
    // takes, rather than resolving to a label this screen cannot vouch for.
    expect(await screen.findByText('Allergies')).toBeInTheDocument();
    expect(screen.getByText('Nut allergy')).toBeInTheDocument();
    expect(screen.getByText('(no longer on the form)')).toBeInTheDocument();
    // There is no known structure to build a page editor from.
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    // A null formId is resolved without ever asking the server for a release.
    expect(releasesRequested).toBe(false);
  });

  it('edits one referral-form page and never logs the referral to the console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let receivedBody: unknown = null;

    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', answers: { legacy: 'kept' } })),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          referral({ id: 'r1', answers: { legacy: 'kept', Other: 'Nut allergy' } }),
        );
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // Waits for the reasons query too — the form does not render until it
    // settles, since the reason field's options come from it.
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Anything else' }));
    const dietary = await screen.findByLabelText('Any additional information?');
    await user.type(dietary, 'Nut allergy');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ answers: { legacy: 'kept', Other: 'Nut allergy' } });
    });

    logSpy.mockRestore();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('edits a fixed field on its configured form page without sending referrer identity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', refereeSurname: 'Rowe-Smith' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Referrer and client details' }));
    expect(
      await screen.findByRole('heading', { name: 'Edit Referrer and client details' }),
    ).toBeInTheDocument();
    const surname = await screen.findByLabelText(/Client.s surname/i);
    await user.clear(surname);
    await user.type(surname, 'Rowe-Smith');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(receivedBody).toMatchObject({ refereeSurname: 'Rowe-Smith', answers: {} });
    });
    expect(receivedBody).not.toHaveProperty('referrerEmail');
  });

  it('does not amend a referral with a malformed stored UK mobile number', async () => {
    let amendments = 0;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', refereePhone: '077009001234' })),
      ),
      http.patch(REFERRAL, () => {
        amendments += 1;
        return HttpResponse.json(referral({ id: 'r1' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Referrer and client details' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Client's contact number: enter a valid UK mobile number.",
    );
    expect(screen.getByLabelText(/Client's contact number/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(amendments).toBe(0);
  });

  it('cancels a page edit without saving it', async () => {
    let amendments = 0;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, () => {
        amendments += 1;
        return HttpResponse.json(referral({ id: 'r1' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Anything else' }));
    await user.type(await screen.findByLabelText('Any additional information?'), 'Do not save');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Referral details' })).toBeInTheDocument();
    expect(amendments).toBe(0);
  });

  it('cancels the referral through the confirm dialog', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.post(REFERRAL_CANCEL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled' })),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Cancel this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Cancel the referral' }));

    await waitFor(() => {
      expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    });
  });

  it('warns when moving into a full session, and still allows the move', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', sessionId: 's2' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Move to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move to another session?' }));
    // Waits for the sessions query itself, not just the referral — selecting
    // before the option list has loaded is a race, not a real interaction.
    await dialog.findByRole('option', { name: /25 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to move to'), 's2');

    expect(await dialog.findByText(/already has 25 of 25 places booked/)).toBeInTheDocument();

    const moveButton = dialog.getByRole('button', { name: 'Move to this session' });
    expect(moveButton).not.toHaveAttribute('disabled');
    await user.click(moveButton);

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ sessionId: 's2', acknowledgeOverCapacity: true });
    });
  });

  it('moves into a session with room without any warning, and does not acknowledge over capacity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({ id: 's1', location: 'Church Hall' }),
            session({ id: 's3', location: 'Spare Hall', booked: 2, capacity: 25 }),
          ],
        }),
      ),
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', sessionId: 's3' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Move to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move to another session?' }));
    await dialog.findByRole('option', { name: /2 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to move to'), 's3');
    await user.click(dialog.getByRole('button', { name: 'Move to this session' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ sessionId: 's3', acknowledgeOverCapacity: false });
    });
    expect(screen.queryByText(/places booked/)).toBeNull();
  });

  it('never offers a closed or already-past session as a move destination', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({ id: 's1', location: 'Church Hall' }),
            session({ id: 's-open', location: 'Spare Hall', booked: 3, capacity: 10 }),
            session({
              id: 's-confirmed',
              location: 'Confirmed Hall',
              status: 'confirmed',
              booked: 5,
              capacity: 20,
            }),
            session({
              id: 's-cancelled',
              location: 'Cancelled Hall',
              status: 'cancelled',
              booked: 6,
              capacity: 25,
            }),
            session({
              id: 's-past',
              location: 'Past Hall',
              sessionDate: addCalendarDays(londonToday(), -1),
              startsAtUtc: `${addCalendarDays(londonToday(), -1)}T09:00:00.000Z`,
              booked: 7,
              capacity: 30,
            }),
          ],
        }),
      ),
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Move to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move to another session?' }));
    await dialog.findByRole('option', { name: /3 of 10 booked/ });
    expect(dialog.queryByRole('option', { name: /5 of 20 booked/ })).toBeNull();
    expect(dialog.queryByRole('option', { name: /6 of 25 booked/ })).toBeNull();
    expect(dialog.queryByRole('option', { name: /7 of 30 booked/ })).toBeNull();
  });

  it('renders a purged referral as purged, with no amend form and no crash', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            refereeFirstName: null,
            refereeSurname: null,
            refereeAddress: null,
            refereePostcode: null,
            refereePhone: null,
            answers: {},
            piiPurgedAt: '2026-08-01T12:00:00.000Z',
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    // Deliberately not `findByRole('heading', { name: 'Referral' })` first —
    // the loading state's own `PageHeader` uses that exact literal title too,
    // so it would resolve on the very first render rather than proving the
    // referral actually loaded. Wait on content that only exists once it has.
    expect(await screen.findByText(/nothing here to amend/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Referral' })).toBeInTheDocument();
    expect(screen.getByText('These were removed by the retention process.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByText('undefined')).toBeNull();
    // Cancel and move travel together now, so neither is offered once the
    // details are gone — the guess recorded as Q35 in `OPEN-QUESTIONS.md`.
    expect(screen.queryByRole('button', { name: 'Move to another session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this referral' })).toBeNull();
  });

  it('shows the previous-referral summary without requesting household details', async () => {
    const matchesRequested = vi.fn();
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            repeatReferrals: { count: 2, mostRecentSessionDate: '2026-08-11' },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () => {
        matchesRequested();
        return HttpResponse.json({ count: 2, mostRecentSessionDate: '2026-08-11', matches: [] });
      }),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Previous referrals' })).toBeInTheDocument();
    expect(screen.getByText(/2 previous possible referrals/)).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element !== null &&
          element.tagName === 'P' &&
          element.textContent.includes('Most recent session: Tue, 11 Aug 2026'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show previous referrals' })).toBeInTheDocument();
    expect(matchesRequested).not.toHaveBeenCalled();
  });

  it('shows matching previous referrals only after an administrator asks', async () => {
    const excludePostcodeRequests: string[] = [];
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            repeatReferrals: { count: 2, mostRecentSessionDate: '2026-08-11' },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, ({ request }) => {
        excludePostcodeRequests.push(
          new URL(request.url).searchParams.get('excludePostcode') ?? '',
        );
        return HttpResponse.json({
          count: 2,
          mostRecentSessionDate: '2026-08-11',
          matches: [
            {
              referralId: 'r0',
              sessionId: 's0',
              sessionDate: '2026-08-11',
              outcome: 'booked',
              matchedOn: ['date_of_birth', 'postcode', 'phone'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
            {
              referralId: 'r-older',
              sessionId: 's-older',
              sessionDate: '2026-07-04',
              outcome: 'no_show',
              matchedOn: ['postcode'],
              refereeFirstName: null,
              refereeSurname: null,
              refereeDateOfBirth: null,
              refereeAddress: null,
              refereePostcode: null,
              refereePhone: '07123 456789',
            },
          ],
        });
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Show previous referrals' });
    await user.click(screen.getByRole('button', { name: 'Show previous referrals' }));

    expect(await screen.findByText('Booked')).toBeInTheDocument();
    expect(screen.getByText('Did not attend')).toBeInTheDocument();
    expect(screen.getByText('Date of birth, Postcode, Phone number')).toBeInTheDocument();
    expect(screen.getByText('Tue, 11 Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('07123 456789')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(excludePostcodeRequests).toEqual(['false']);
    await user.click(screen.getByRole('checkbox', { name: 'Exclude postcode matches' }));
    await waitFor(() => {
      expect(excludePostcodeRequests).toEqual(['false', 'true']);
    });
  });

  it('shows an honest empty previous-referrals summary without offering a detail request', async () => {
    const matchesRequested = vi.fn();
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({ id: 'r1', repeatReferrals: { count: 0, mostRecentSessionDate: null } }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () => {
        matchesRequested();
        return HttpResponse.json({ count: 0, mostRecentSessionDate: null, matches: [] });
      }),
    );

    renderApp('/referrals/r1');

    expect(
      await screen.findByText('No previous referrals were found in the last twelve months.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show previous referrals' })).toBeNull();
    expect(matchesRequested).not.toHaveBeenCalled();
  });

  it('offers accept and reject only while a referral waits on its referrer', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));
    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // A referral whose referrer is recognised has no such decision outstanding —
    // it is only waiting to be read through, which is a different pass.
    expect(screen.queryByRole('button', { name: 'Approve this referral' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject this referral' })).toBeNull();
  });

  it('approves a referral directly, with no confirming question', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'active' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(
      screen.getByRole('heading', {
        name: 'This referral is waiting for the referrer to be approved',
      }),
    ).toBeInTheDocument();

    // Approving an unrecognised referrer is the ordinary outcome: no dialog,
    // nowhere to type a reason, nothing sent but the decision itself.
    await user.click(screen.getByRole('button', { name: 'Approve this referral' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => {
      expect(body).toEqual({});
    });
    // The panel goes once there is nothing left to decide, and a
    // screen-reader user is told what happened and given somewhere to land.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Approve this referral' })).toBeNull();
    });
    expect(screen.getByText('Referral approved.')).toBeInTheDocument();
  });

  it('does not offer authorising a referrer when the referral has no email address', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'pending_review', referrerEmail: null })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.getByRole('button', { name: 'Approve this referral' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and authorise referrer' })).toBeNull();
  });

  it('defaults the organisation from the referral and lets the administrator correct it before authorising', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'active' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve and authorise referrer' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Authorise this referrer' }));
    expect(dialog.getByText(/referrer@riverside\.org only/)).toBeInTheDocument();
    expect(dialog.getByText(/not everyone at that organisation’s domain/)).toBeInTheDocument();
    const organisation = dialog.getByLabelText('Organisation');
    expect(organisation).toHaveValue('Riverside Church');

    await user.clear(organisation);
    await user.type(organisation, 'Riverside Community Church');
    await user.click(dialog.getByRole('button', { name: 'Approve and authorise referrer' }));

    await waitFor(() => {
      expect(body).toEqual({
        authoriseReferrer: { organisationName: 'Riverside Community Church' },
      });
    });
  });

  it('authorises the organisation from the referral when the administrator leaves the default unchanged', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'active' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve and authorise referrer' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Authorise this referrer' }));
    expect(dialog.getByLabelText('Organisation')).toHaveValue('Riverside Church');
    await user.click(dialog.getByRole('button', { name: 'Approve and authorise referrer' }));

    await waitFor(() => {
      expect(body).toEqual({ authoriseReferrer: { organisationName: 'Riverside Church' } });
    });
  });

  it('does not authorise a referrer when the administrator clears the organisation', async () => {
    const accept = vi.fn();
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, accept),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve and authorise referrer' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Authorise this referrer' }));
    await user.clear(dialog.getByLabelText('Organisation'));
    await user.click(dialog.getByRole('button', { name: 'Approve and authorise referrer' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Enter the organisation this referrer belongs to.',
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it('shows the server’s message and leaves plain approval available if authorising the referrer races', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That referrer is already on the authorised list.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve and authorise referrer' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Authorise this referrer' }));
    await user.type(dialog.getByLabelText('Organisation'), 'Riverside Community Church');
    await user.click(dialog.getByRole('button', { name: 'Approve and authorise referrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referrer is already on the authorised list.',
    );
    expect(screen.getByRole('button', { name: 'Approve this referral' })).toBeInTheDocument();
  });

  it('rejects with the reason typed in the rejection dialog', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_REJECT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'rejected' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Reject this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Reject this referral?' }));
    await user.type(
      dialog.getByLabelText('Reason for rejection (optional)'),
      'Rang the school, they had not heard of them.',
    );
    await user.click(dialog.getByRole('button', { name: 'Reject referral' }));

    await waitFor(() => {
      expect(body).toEqual({ comment: 'Rang the school, they had not heard of them.' });
    });
    // The panel's own controls just left the page with it — a screen-reader
    // user needs telling what happened and somewhere real to land.
    expect(await screen.findByText('Referral rejected.')).toBeInTheDocument();
  });

  it('rejects without a comment rather than sending an empty one', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_REJECT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'rejected' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Reject this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Reject this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Reject referral' }));

    // `''` would be a 400 on a field nobody filled in — the server's bound is
    // `minLength: 1`.
    await waitFor(() => {
      expect(body).toEqual({});
    });
  });

  it('shows the server’s message when another administrator reviewed it first', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That referral is not awaiting review.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve this referral' }));

    // A 409 carries the one useful sentence; a generic apology throws it away.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referral is not awaiting review.',
    );
    // The panel stays — nothing was decided — so plain approval is still there
    // to try again, and no "Referral approved." announcement was made.
    expect(screen.getByRole('button', { name: 'Approve this referral' })).toBeInTheDocument();
    expect(screen.queryByText('Referral approved.')).toBeNull();
  });

  it('offers the way back to the search results only when that is where it was opened from', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    // Reached from the referrals list: nothing to go back to.
    const { router } = renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.queryByRole('link', { name: 'Back to search results' })).toBeNull();

    // The flag a search result link carries — a boolean, never the search
    // itself, because history is not a place a date of birth may go.
    await router.navigate('/referrals/r1', { state: { fromSearch: true } });

    expect(await screen.findByRole('link', { name: 'Back to search results' })).toHaveAttribute(
      'href',
      '/referrals/search',
    );
  });

  it('cancel and move sit together as two buttons, and moving asks which session', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel this referral' });
    const moveButton = screen.getByRole('button', { name: 'Move to another session' });
    // The same row, which is what puts them on one line.
    expect(moveButton.parentElement).toBe(cancelButton.parentElement);

    // The session list is a prompt, not something sitting open on the screen.
    expect(screen.queryByLabelText('Choose session to move to')).toBeNull();
    await user.click(moveButton);
    expect(
      within(screen.getByRole('dialog', { name: 'Move to another session?' })).getByLabelText(
        'Choose session to move to',
      ),
    ).toBeInTheDocument();
  });

  it('shows the review comment on an already-reviewed referral', async () => {
    // There is no review history, so this one line is the whole answer to "why
    // was this rejected?" six months later.
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            status: 'rejected',
            reviewComment: 'Referrer could not be reached.',
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Referrer could not be reached.')).toBeInTheDocument();
  });

  it('a cancelled referral shows why its controls are refused, without hiding them', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'cancelled' }))),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(
      await screen.findByText(
        'This referral has been cancelled, so it can no longer be amended or moved from here.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('copying a referral', () => {
  it('shows the outcome and a copy button for a household that did not turn up', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'no_show' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('No Show/Not in')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Copy to another session' }),
    ).toBeInTheDocument();
  });

  // The server refuses both once a parcel has an outcome — "the same stopping
  // point as a move", settled 2026-08-15 — and `screenDetails.md` is explicit
  // that moving and copying "must not be offered as alternatives for the same
  // referral". An administrator mid-call who picks Move here would rewrite the
  // record of a session that has already happened instead of making a booking.
  it('does not offer cancelling or moving a household who did not turn up', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'no_show' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/did not turn up/)).toBeInTheDocument();
  });

  it('does not offer cancelling or moving a household who already collected, and offers a copy', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'attended' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      await screen.findByRole('button', { name: 'Copy to another session' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Copy it to another session to make a new referral/),
    ).toBeInTheDocument();
  });

  it('leaves cancelling and moving live for a household still to come', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'active', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('does not offer to copy a referral still on its way to being fed — that is a move, not a copy', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'active', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.queryByRole('button', { name: 'Copy to another session' })).toBeNull();
  });

  it('offers a copy on a cancelled referral, without ever showing "Still booked" beside "Cancelled"', async () => {
    // The server sends outcome: "booked" on a cancelled referral (nothing
    // happened on the day) — `displayedOutcome` must not let that reach the
    // screen next to the word "Cancelled".
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(
      await screen.findByRole('button', { name: 'Copy to another session' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Still booked')).toBeNull();
    expect(screen.queryByText('Outcome')).toBeNull();
  });

  it('copies a referral onto the chosen session and then shows the new referral, not the original', async () => {
    let receivedBody: unknown = null;
    const copiedReferral = referral({
      id: 'r2',
      sessionId: 's1',
      status: 'reviewed',
      outcome: 'booked',
      refereeFirstName: 'Alex',
      refereeSurname: 'Carter',
      adminInfo: 'Copied from referral dated 2026-07-01',
    });
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(copiedReferral);
      }),
      http.get('/api/v1/referrals/r2', () => HttpResponse.json(copiedReferral)),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    // Unlike the move picker, the referral's own session is offered here — a
    // household who cancelled and rang back can be copied straight back onto
    // the session they cancelled from.
    await dialog.findByRole('option', { name: /10 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    await waitFor(() => {
      expect(receivedBody).toEqual({ sessionId: 's1', acknowledgeOverCapacity: false });
    });

    // The screen now shows the copy, not the referral it was made from.
    expect(await screen.findByRole('heading', { name: 'Alex Carter' })).toBeInTheDocument();
    expect(screen.getByText('Copied from referral dated 2026-07-01')).toBeInTheDocument();
  });

  it('never offers a closed or already-past session as a copy destination, not even the referral’s own', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            // The referral's own session (`s1`, from `referral()`'s default),
            // now closed — so the usual "copy back onto your own session"
            // exception no longer applies to it either.
            session({ id: 's1', location: 'Church Hall', status: 'confirmed' }),
            session({ id: 's-open', location: 'Spare Hall', booked: 3, capacity: 10 }),
            session({
              id: 's-cancelled',
              location: 'Cancelled Hall',
              status: 'cancelled',
              booked: 6,
              capacity: 25,
            }),
            session({
              id: 's-past',
              location: 'Past Hall',
              sessionDate: addCalendarDays(londonToday(), -1),
              startsAtUtc: `${addCalendarDays(londonToday(), -1)}T09:00:00.000Z`,
              booked: 7,
              capacity: 30,
            }),
          ],
        }),
      ),
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /3 of 10 booked/ });
    expect(dialog.queryByRole('option', { name: /10 of 25 booked/ })).toBeNull();
    expect(dialog.queryByRole('option', { name: /6 of 25 booked/ })).toBeNull();
    expect(dialog.queryByRole('option', { name: /7 of 30 booked/ })).toBeNull();
  });

  it('refuses to confirm with no session chosen, and sends no request', async () => {
    let posts = 0;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, () => {
        posts += 1;
        return HttpResponse.json(referral({ id: 'r2', sessionId: 's1', status: 'reviewed' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    expect(
      await dialog.findByText('Choose a session to copy this referral to.'),
    ).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it('warns when copying into a full session, and still allows confirming with acknowledgeOverCapacity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r2', sessionId: 's2', status: 'reviewed' }));
      }),
      http.get('/api/v1/referrals/r2', () =>
        HttpResponse.json(referral({ id: 'r2', sessionId: 's2', status: 'reviewed' })),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /25 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's2');

    expect(await dialog.findByText(/already has 25 of 25 places booked/)).toBeInTheDocument();

    const confirmButton = dialog.getByRole('button', { name: 'Copy to this session' });
    expect(confirmButton).not.toHaveAttribute('disabled');
    await user.click(confirmButton);

    await waitFor(() => {
      expect(receivedBody).toEqual({ sessionId: 's2', acknowledgeOverCapacity: true });
    });
  });

  it('shows the server’s message verbatim on a 409, not a generic apology', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'This session has been confirmed and cannot take a copy.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /10 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This session has been confirmed and cannot take a copy.',
    );
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  // A `409` here can mean the screen's own belief about the active release was
  // stale — a release was published (even a rules-only one) after this screen
  // last checked, so it still offered the same-request dialog instead of the
  // review-onto-today's-form link. Refetching the active questionnaire on that
  // refusal is what stops a second press walking into the same `409` again.
  it('refetches the active form after a same-request copy is refused, so the button offers review instead of repeating the 409', async () => {
    let questionnaireRequests = 0;

    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.get(QUESTIONNAIRE, () => {
        questionnaireRequests += 1;
        // The first fetch still matches the referral's own `formId` — the
        // screen genuinely believed a same-request copy was available. The
        // one after the refusal reflects a release published since.
        const formId = questionnaireRequests === 1 ? FORM_ID : 'form-2';
        return HttpResponse.json({ formId, questionnaire: JSON.stringify(rawFormConfig) });
      }),
      http.post(REFERRAL_COPY, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message:
                'The referral form has changed since this referral was made, so it must be reviewed on the current form rather than copied.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /10 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'must be reviewed on the current form rather than copied',
    );

    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    // Closing the dialog leaves the corrected button behind: a link to
    // review, not the same-request button that would repeat the 409.
    expect(
      await screen.findByRole('link', { name: 'Copy to another session' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy to another session' })).toBeNull();
  });

  /**
   * The route is not idempotent and the server does not refuse a second copy
   * (`API.md`, "Guard the button against a double press") — two landed clicks
   * make two referrals, two places held and two bags packed. The button relies
   * on a synchronous `useRef`, not `aria-disabled` alone, because `disabled`
   * only takes effect on the next render and a real double tap lands both
   * clicks first. `fireEvent` fires both clicks in the same tick, and the
   * server-side request is held open until after both have landed, so this
   * would catch the guard being removed or swapped for `disabled`.
   */
  it('guards the confirm button against a double click, sending exactly one copy request', async () => {
    let posts = 0;
    let releaseResponse: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const copiedReferral = referral({ id: 'r2', sessionId: 's1', status: 'reviewed' });
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async () => {
        posts += 1;
        await held;
        return HttpResponse.json(copiedReferral);
      }),
      http.get('/api/v1/referrals/r2', () => HttpResponse.json(copiedReferral)),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /10 of 25 booked/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');

    const confirmButton = dialog.getByRole('button', { name: 'Copy to this session' });
    // Both clicks dispatched inside one `act` batch, so React has not yet
    // re-rendered `ConfirmDialog`'s own `disabled={busy}` between them — the
    // same landing pattern as two real taps arriving before the browser has
    // painted the first response, which is exactly what `copying.current`
    // guards against.
    act(() => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });

    releaseResponse?.();

    await waitFor(() => {
      expect(posts).toBe(1);
    });
  });
});

describe('welcoming a newly authorised referrer', () => {
  async function approveAndAuthorise(organisation?: string) {
    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve and authorise referrer' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Authorise this referrer' }));
    if (organisation !== undefined) {
      await user.clear(dialog.getByLabelText('Organisation'));
      await user.type(dialog.getByLabelText('Organisation'), organisation);
    }
    await user.click(dialog.getByRole('button', { name: 'Approve and authorise referrer' }));
  }

  it('opens a Gmail email to the referrer in the administrator’s own account once authorised', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () => HttpResponse.json(referral({ id: 'r1', status: 'active' }))),
    );

    await approveAndAuthorise('Riverside Community Church');

    expect(
      await screen.findByText(/Referral approved and referrer authorised\./),
    ).toBeInTheDocument();
    const params = openedComposeParams();
    expect(params.get('authuser')).toBe('pete@x.com');
    expect(params.get('to')).toBe('referrer@riverside.org');
    expect(params.get('body')).toMatch(/^Hi Sam Referrer\n/);
    expect(
      screen.queryByRole('link', { name: 'Open the welcome email in Gmail (opens in a new tab)' }),
    ).toBeNull();
  });

  it('never opens an email for a plain approval, which adds nobody to the list', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () => HttpResponse.json(referral({ id: 'r1', status: 'active' }))),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve this referral' }));

    expect(await screen.findByText('Referral approved.')).toBeInTheDocument();
    expect(openTab).not.toHaveBeenCalled();
  });

  it('never opens an email when the server refuses to authorise the referrer', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That referrer is already on the authorised list.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    await approveAndAuthorise();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referrer is already on the authorised list.',
    );
    expect(openTab).not.toHaveBeenCalled();
  });

  it('offers the email as a link when the browser blocks the new tab', async () => {
    openTab.mockReturnValue(null);
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () => HttpResponse.json(referral({ id: 'r1', status: 'active' }))),
    );

    await approveAndAuthorise();

    const link = await screen.findByRole('link', {
      name: 'Open the welcome email in Gmail (opens in a new tab)',
    });
    const params = new URL(link.getAttribute('href') ?? '').searchParams;
    expect(params.get('to')).toBe('referrer@riverside.org');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Referral approved and referrer authorised.',
    );
  });
});
