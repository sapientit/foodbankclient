import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { SessionModelSummary } from './queries';

const SESSION_ID = 'session-1';

const SESSION: Session = {
  id: SESSION_ID,
  sessionDate: '2026-10-19',
  startTime: '10:00',
  startsAtUtc: '2026-10-19T09:00:00.000Z',
  durationMinutes: 90,
  location: 'St Mary’s Hall',
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  deliveryCapacity: 0,
  deliveryBooked: 0,
  capacity: 25,
  booked: 1,
  status: 'planned',
  cancelledReason: null,
  isCustomised: false,
  recurringSessionId: null,
  occurrenceDate: null,
};

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@example.org', displayName: 'Lead', role: 'team_lead' },
      }),
    ),
    http.get('/api/v1/sessions/:sessionId', () => HttpResponse.json(SESSION)),
    http.get('/api/v1/sessions/:sessionId/pick-list', () =>
      HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'No pick list.', requestId: 'req-1' } },
        { status: 404 },
      ),
    ),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({ sessionId: SESSION_ID, unreadTotal: 0, households: [] }),
    ),
  );
});

describe('team-lead Model summary', () => {
  it('uses the JSON answers in the model-order copy', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/model-summary', () =>
        HttpResponse.json({
          sessionId: SESSION_ID,
          households: [
            {
              pickNumber: 7,
              modelParcelName: 'Family parcel',
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              adults: 2,
              children: 1,
              collectionMethod: 'collection',
              answers: {
                'Collection method': 'On Foot',
                'Dietary Req': 'Gluten-free',
                Allergies: 'Old value',
              },
            },
          ],
        } satisfies SessionModelSummary),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}/model-summary`);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('row', { name: /Jamie Rowe/ })).toHaveTextContent('On Foot');
    expect(within(table).getByRole('row', { name: /Jamie Rowe/ })).toHaveTextContent('Gluten-free');
    expect(within(table).queryByText('Old value')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Copy model summary' }));
    expect(await navigator.clipboard.readText()).toBe(
      'Pick #\tModel name\tClient\tCollection method\tDietary Req\n#7\tFamily parcel\tJamie Rowe\tOn Foot\tGluten-free',
    );
  });
});
