import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

/**
 * The no-role-guards rule, made executable.
 *
 * A team lead has no Users link in their menu, and typing the URL anyway must
 * still **make the request**. The server re-checks the role from the signed token
 * on every request, and that is the only check that means anything: a
 * client-side gate would merely hide a screen from somebody who had already
 * edited `role` in devtools, while implying the app had a security boundary it
 * does not.
 *
 * Its own file because the signed-in actor is fixed per file — `ensureSession()`
 * is memoised per page load by design. See `test/render-app.tsx`.
 */
describe('a team lead typing an admin URL', () => {
  it('lets a team lead reach the users screen and shows the API’s refusal rather than a client-side block', async () => {
    const listed = vi.fn();

    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.get('/api/v1/users', () => {
        listed();
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

    renderApp('/users');

    // A plain explanation, not a crash and not an accusation.
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');

    // The load-bearing half: the request happened.
    expect(listed).toHaveBeenCalled();
  });

  it('offers a team lead no Users link to follow', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
    );

    renderApp('/');

    // Roles pick menus. That is the whole of what they do.
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });
});
