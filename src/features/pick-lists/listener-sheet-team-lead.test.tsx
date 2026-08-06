import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
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
        'Cause Details': 'The boiler broke and used the rent money.',
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
      answers: { 'Cause Details': 'The first payment has not arrived.' },
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

  it('renders the four allowed fields, including server-provided Cause Details, and no other referral data', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/listener-sheet', () =>
        HttpResponse.json(LISTENER_SHEET),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}/listener`);

    await screen.findByRole('columnheader', { name: 'Name' });

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Reason for referral' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cause Details' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fuel help' })).toBeInTheDocument();
    expect(screen.getByText('Unexpected expenses')).toBeInTheDocument();
    expect(screen.getByText('The boiler broke and used the rent money.')).toBeInTheDocument();
    expect(screen.getAllByText('No')).toHaveLength(2);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('None given')).toBeInTheDocument();

    expect(screen.queryByText('17 Never Print Close')).toBeNull();
    expect(screen.queryByText('07000 000000')).toBeNull();
    expect(screen.queryByText('Baked beans: 2')).toBeNull();
  });
});
