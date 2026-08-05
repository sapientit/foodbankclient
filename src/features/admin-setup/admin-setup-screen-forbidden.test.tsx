import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

/**
 * The no-role-guards rule, made executable — the same shape as
 * `users-screen-forbidden.test.tsx` and
 * `model-parcels-screen-forbidden.test.tsx`.
 *
 * A team lead has no Referrers or Reasons for referral link in their menu
 * (`API.md` §2: admin only), and typing either URL anyway must still **make
 * the request** rather than being blocked client-side.
 *
 * Its own file because the signed-in actor is fixed per file —
 * `ensureSession()` is memoised per page load. See `test/render-app.tsx`.
 */
describe('a team lead typing an admin-setup URL', () => {
  it('lets a team lead reach the referrers screen and shows the API’s refusal', async () => {
    const listed = vi.fn();

    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.get('/api/v1/authorised-referrers', () => {
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

    renderApp('/referrers');

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
    expect(listed).toHaveBeenCalled();
  });

  it('offers a team lead neither a Referrers nor a Reasons for referral link', async () => {
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

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Referrers' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Reasons for referral' })).toBeNull();
  });
});
