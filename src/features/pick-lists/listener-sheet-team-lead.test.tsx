import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { listenerColumns } from './listener-sheet.logic';
import type { ListenerSheet } from './queries';

const SESSION_ID = 'session-1';

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
      refereeFirstName: 'Amina',
      refereeSurname: 'Ahmed',
      reason: 'Unexpected expenses',
      needsFuelHelp: true,
      answers: {
        reasonAdditional: 'The boiler broke and used the rent money.',
        Secondary: 'Debt',
        Address: '17 Never Print Close',
        Phone: '07000 000000',
        'Parcel contents': 'Baked beans: 2',
      },
    },
    {
      referralId: 'referral-awaiting-review',
      refereeFirstName: 'Ben',
      refereeSurname: 'Brown',
      reason: 'Benefit delay',
      needsFuelHelp: false,
      answers: { reasonAdditional: 'The first payment has not arrived.' },
    },
    {
      referralId: 'referral-approved',
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
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    expect(await screen.findByRole('row', { name: /Amina Ahmed/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Cora Cole/ })).toBeInTheDocument();
  });

  it('shows every question the form marks for the listener sheet, and no other referral data', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json(LISTENER_SHEET),
      ),
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
    // sheet until the form started choosing the columns.
    expect(screen.getByText('Debt')).toBeInTheDocument();
    expect(screen.getAllByText('No')).toHaveLength(2);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getAllByText('None given')).toHaveLength(3);

    // The endpoint sends the answers whole, so what keeps the rest of a
    // referral off this page is the marker and nothing else.
    expect(screen.queryByText('17 Never Print Close')).toBeNull();
    expect(screen.queryByText('07000 000000')).toBeNull();
    expect(screen.queryByText('Baked beans: 2')).toBeNull();
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
