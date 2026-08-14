import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

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

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
    http.get('/api/v1/sessions/:id', () =>
      HttpResponse.json({
        id: 'session-1',
        sessionDate: '2099-08-06',
        startTime: '10:00',
        startsAtUtc: '2099-08-06T09:00:00.000Z',
        durationMinutes: 90,
        location: 'St Mary’s Hall',
        deliveryTime: null,
        deliveriesAllowed: false,
        capacity: 25,
        booked: 0,
        status: 'planned',
        cancelledReason: null,
        isCustomised: false,
        recurringSessionId: null,
        occurrenceDate: null,
      }),
    ),
    http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
  );
});

describe('a team lead opening a session with invalid preference rules', () => {
  it('explains the local configuration fault without attempting pick-list generation', async () => {
    let generationRequests = 0;
    server.use(
      http.post('/api/v1/sessions/:sessionId/pick-list', () => {
        generationRequests += 1;
        return HttpResponse.json({});
      }),
    );

    renderApp('/run-sessions/session-1');

    expect(
      await screen.findByRole('heading', { name: 'Pick-list rules need attention' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Rule Tea/Coffee: $selectedAnswer cannot resolve active stock items for Tea, Coffee, Decaf Coffee, Hot Chocolate.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('We could not reach the server')).toBeNull();
    expect(generationRequests).toBe(0);
  });
});
