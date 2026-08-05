import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

/**
 * The no-role-guards rule, made executable for sessions.
 *
 * `/sessions/new` is not in a team lead's menu, but typing the URL still
 * renders the same create form `CreateSessionScreen` renders for anyone — see
 * that file's module comment — and submitting it still makes the real
 * `POST /sessions`, which only the server can refuse. This is the one
 * genuinely admin-only mutation in the sessions slice that a client-side form
 * never predicts, unlike a confirmed session's amend/cancel, which
 * `session-detail-screen.test.tsx` covers separately.
 *
 * Its own file because `renderApp`'s signed-in actor is fixed per module.
 */
describe('a team lead typing the add-a-session URL', () => {
  it('renders the same form and shows the server’s 403 rather than crashing', async () => {
    const posted = vi.fn();
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.post('/api/v1/sessions', () => {
        posted();
        return HttpResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'This action requires the admin role',
              requestId: 'r1',
            },
          },
          { status: 403 },
        );
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');

    // The load-bearing half: the request was actually made, not blocked client-side.
    expect(posted).toHaveBeenCalled();
  });

  it('offers a team lead no “Add a session” link to follow in the first place', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.get('/api/v1/sessions', () => HttpResponse.json({ sessions: [] })),
    );

    renderApp('/sessions');

    await screen.findByRole('heading', { name: 'Your sessions' });
    expect(screen.queryByRole('link', { name: 'Add a session' })).toBeNull();
  });
});
