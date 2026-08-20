import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { referralKeys } from '../referrals/keys';
import { listenerColumns } from './listener-sheet.logic';
import type { ListenerSheet } from './queries';
import type { ReferralReason } from '../referrals/queries';

const SESSION_ID = 'session-1';

// A minimal valid rule makes the fresh referral contribute a distinctive line
// to reconciliation. The maintained rules themselves are covered separately.
vi.mock('./preference-rules.config.json', () => ({
  default: {
    rules: [
      {
        when: { key: 'Tea/Coffee' },
        cases: [],
        otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
      },
    ],
  },
}));

/*
 * The maintained reason lookup. A question choosing from it — the secondary
 * cause of crisis — stores the reason's **id**, so this is what stands between
 * a listener and a page of identifiers. Public rather than admin: a team lead
 * is refused `GET /referral-reasons`.
 */
const REASONS = [
  { id: 'reason-debt', code: 'debt', label: 'Debt', displayOrder: 1 },
  { id: 'reason-illness', code: 'illness', label: 'Illness', displayOrder: 2 },
] satisfies ReferralReason[];

function reasonsHandler() {
  return http.get('/api/v1/public/referral-reasons', () =>
    HttpResponse.json({ referralReasons: REASONS }),
  );
}

/*
 * The endpoint's deliberately narrow projection is the privacy boundary: it
 * has already excluded delivery, cancelled and rejected households. There is
 * no status or delivery flag in this generated response for the browser to
 * second-guess, so this fixture represents the remaining households only.
 */
const LISTENER_SHEET = {
  sessionId: SESSION_ID,
  households: [
    {
      referralId: 'referral-active',
      pickNumber: 1,
      refereeFirstName: 'Amina',
      refereeSurname: 'Ahmed',
      reason: 'Unexpected expenses',
      needsFuelHelp: true,
      answers: {
        reasonAdditional: 'The boiler broke and used the rent money.',
        Secondary: 'reason-debt',
        Address: '17 Never Print Close',
        Phone: '07000 000000',
        'Parcel contents': 'Baked beans: 2',
      },
    },
    {
      referralId: 'referral-awaiting-review',
      pickNumber: 2,
      refereeFirstName: 'Ben',
      refereeSurname: 'Brown',
      reason: 'Benefit delay',
      needsFuelHelp: false,
      answers: { reasonAdditional: 'The first payment has not arrived.' },
    },
    {
      referralId: 'referral-approved',
      pickNumber: 3,
      refereeFirstName: 'Cora',
      refereeSurname: 'Cole',
      reason: 'Low income',
      needsFuelHelp: false,
      answers: {},
    },
  ],
} satisfies ListenerSheet;

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
  );
});

describe('a team lead listener sheet', () => {
  it('shows the server-filtered non-delivery households, including every non-cancelled and non-rejected status', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', ({ params }) => {
        expect(params.sessionId).toBe(SESSION_ID);
        return HttpResponse.json(LISTENER_SHEET);
      }),
      reasonsHandler(),
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    expect(await screen.findByRole('row', { name: /Amina Ahmed/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Cora Cole/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pick number' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('refreshes the client list before returning to rebuild pick lists after new clients are acknowledged', async () => {
    const user = userEvent.setup();
    let referralReads = 0;
    let reconciliationPosts = 0;
    let reconciliationBody: unknown;
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json(
          {
            error: {
              code: 'NEW_CLIENTS_ASSIGNED',
              message: 'New clients have been assigned to this session.',
              requestId: 'request-1',
              details: { missingParcels: ['referral-new'] },
            },
          },
          { status: 409 },
        ),
      ),
      http.get('/api/v1/referrals', ({ request }) => {
        expect(new URL(request.url).searchParams.get('sessionId')).toBe(SESSION_ID);
        referralReads += 1;
        return HttpResponse.json({
          referrals: [
            { id: 'referral-new', adults: 1, children: 0, answers: { 'Tea/Coffee': 'Tea' } },
          ],
        });
      }),
      http.get('/api/v1/sessions/:sessionId', () =>
        HttpResponse.json({
          id: SESSION_ID,
          sessionDate: '2099-08-06',
          startTime: '10:00',
          startsAtUtc: '2099-08-06T09:00:00.000Z',
          durationMinutes: 90,
          location: 'St Mary’s Hall',
          deliveryWindowStart: null,
          deliveryWindowEnd: null,
          deliveryCapacity: 0,
          capacity: 25,
          booked: 1,
          status: 'planned',
          cancelledReason: null,
          isCustomised: false,
          recurringSessionId: null,
          occurrenceDate: null,
        }),
      ),
      http.get('/api/v1/stock/items', () =>
        HttpResponse.json({
          items: [
            {
              id: 'tea',
              name: 'Tea',
              category: 'Drinks',
              description: null,
              shelfNumber: 'A1',
              isActive: true,
            },
            {
              id: 'coffee',
              name: 'Coffee',
              category: 'Drinks',
              description: null,
              shelfNumber: 'A2',
              isActive: true,
            },
            {
              id: 'decaf',
              name: 'Decaf Coffee',
              category: 'Drinks',
              description: null,
              shelfNumber: 'A3',
              isActive: true,
            },
            {
              id: 'chocolate',
              name: 'Hot Chocolate',
              category: 'Drinks',
              description: null,
              shelfNumber: 'A4',
              isActive: true,
            },
          ],
        }),
      ),
      http.post('/api/v1/sessions/:sessionId/pick-list', async ({ params, request }) => {
        expect(params.sessionId).toBe(SESSION_ID);
        reconciliationPosts += 1;
        reconciliationBody = await request.json();
        return HttpResponse.json({ sessionId: SESSION_ID });
      }),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({
          pickList: {
            id: 'pick-list-1',
            sessionId: SESSION_ID,
            status: 'draft',
            generatedAt: '2099-08-06T09:00:00.000Z',
            firstPrintedAt: null,
            confirmedAt: null,
          },
          parcels: [
            {
              id: 'parcel-new',
              referralId: 'referral-new',
              pickNumber: 1,
              refereeFirstName: 'Nora',
              refereeSurname: 'New',
              isDelivery: false,
              adults: 1,
              children: 0,
              householdSize: 1,
              reviewedAt: null,
              attendance: 'pending',
              notes: null,
              answers: {},
              lines: [],
            },
          ],
        }),
      ),
      reasonsHandler(),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
    });
    await queryClient.fetchQuery({
      queryKey: referralKeys.list({ sessionId: SESSION_ID }),
      queryFn: () => Promise.resolve([]),
    });
    const { router } = renderApp(`/run-sessions/${SESSION_ID}/listener`, queryClient);

    expect(
      await screen.findByRole('heading', { name: 'New clients assigned' }),
    ).toBeInTheDocument();
    expect(screen.getByText('New clients have been assigned to this session.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print listener sheet' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Acknowledge and return to session' }));
    expect(referralReads).toBe(1);
    expect(await screen.findByRole('row', { name: /#1.*Nora New/ })).toBeInTheDocument();
    expect(reconciliationPosts).toBe(1);
    expect(reconciliationBody).toEqual({
      preferenceLines: [
        { referralId: 'referral-new', lines: [{ stockItemId: 'tea', quantity: 1 }] },
      ],
    });
    expect(router.state.location.pathname).toBe(`/run-sessions/${SESSION_ID}`);
  });

  it('shows every question the form marks for the listener sheet, and no other referral data', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json(LISTENER_SHEET),
      ),
      reasonsHandler(),
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    // Headed by the questions as the charity words them in the questionnaire,
    // not by names this screen made up — the marker is what puts them here.
    await screen.findByRole('columnheader', { name: "Client's first name" });
    for (const heading of [
      "Client's surname",
      'Main cause of crisis',
      'Additional information about crisis',
      'Secondary cause of crisis',
      'Does the client need help with Energy costs?',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }

    expect(screen.getByText('Unexpected expenses')).toBeInTheDocument();
    expect(screen.getByText('The boiler broke and used the rent money.')).toBeInTheDocument();
    // The secondary cause: required by `screenDetails.md` and absent from this
    // sheet until the form started choosing the columns. It is stored as the
    // reason's id and must print as the words — a listener reads this aloud.
    expect(screen.getByText('Debt')).toBeInTheDocument();
    expect(screen.queryByText('reason-debt')).toBeNull();
    expect(screen.getAllByText('No')).toHaveLength(2);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getAllByText('None given')).toHaveLength(3);

    // The endpoint sends the answers whole, so what keeps the rest of a
    // referral off this page is the marker and nothing else.
    expect(screen.queryByText('17 Never Print Close')).toBeNull();
    expect(screen.queryByText('07000 000000')).toBeNull();
    expect(screen.queryByText('Baked beans: 2')).toBeNull();
  });

  it('says so, rather than printing an identifier, when a stored reason is no longer on the list', async () => {
    // The public lookup sends the active reasons only, so a referral naming a
    // reason retired since it was made cannot be resolved here at all. Marked
    // as a guess in the server's OPEN-QUESTIONS.md.
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json({
          ...LISTENER_SHEET,
          households: LISTENER_SHEET.households.slice(0, 1).map((household) => ({
            ...household,
            answers: { ...household.answers, Secondary: 'reason-retired' },
          })),
        } satisfies ListenerSheet),
      ),
      reasonsHandler(),
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    expect(await screen.findByText('No longer listed')).toBeInTheDocument();
    expect(screen.queryByText('reason-retired')).toBeNull();
  });

  it('holds the sheet back rather than printing it when the reason lookup fails', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json(LISTENER_SHEET),
      ),
      http.get('/api/v1/public/referral-reasons', () => HttpResponse.json({}, { status: 500 })),
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    // A page of identifiers where a cause of crisis should be is worse than a
    // page the team lead can retry.
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Amina Ahmed/ })).toBeNull();
  });

  it('never prints a column for a marked question the endpoint does not send', () => {
    /*
     * The listener-sheet response is narrow on purpose — no address, postcode,
     * phone or date of birth — and that is what keeps them off the one printed
     * page a reason for referral may appear on. A marker cannot widen it, and a
     * question it cannot fill is left out rather than printed empty.
     */
    const marked = listenerColumns().map((column) => column.key);

    expect(marked).toEqual([
      'refereeFirstName',
      'refereeSurname',
      'reasonId',
      'reasonAdditional',
      'Secondary',
      'needsFuelHelp',
    ]);
    expect(
      listenerColumns({
        version: 1,
        pages: [
          {
            pageNum: 1,
            pageTitle: 'Test',
            questions: [
              {
                type: 'keyField',
                field: 'refereePostcode',
                key: 'refereePostcode',
                label: "Client's postcode",
                required: true,
                forListenerSheet: true,
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});
