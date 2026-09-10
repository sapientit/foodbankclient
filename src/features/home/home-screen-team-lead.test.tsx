import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: {
          id: 'lead',
          email: 'lead@example.test',
          displayName: 'Terry Lead',
          role: 'team_lead',
        },
      }),
    ),
    http.get('/api/v1/sessions', () => HttpResponse.json({ sessions: [] })),
  );
});

describe('the team-lead dashboard', () => {
  it('does not render or request administrator-only summaries', async () => {
    let volunteerCodeExpiryRequested = false;
    server.use(
      http.get('/api/v1/stock/take/volunteer-codes/latest', () => {
        volunteerCodeExpiryRequested = true;
        return HttpResponse.json({ latest: null });
      }),
    );
    renderApp('/');
    expect(await screen.findByRole('heading', { name: "Today's sessions" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Referrals' })).toBeNull();
    expect(screen.queryByText(/stock items with low stock/)).toBeNull();
    expect(screen.queryByText(/Volunteer code expires at/)).toBeNull();
    expect(screen.queryByText(/unread SMS messages/)).toBeNull();
    expect(volunteerCodeExpiryRequested).toBe(false);
  });
});
