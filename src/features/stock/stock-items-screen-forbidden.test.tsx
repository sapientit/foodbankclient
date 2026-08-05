import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

describe('a team lead typing the stock-item maintenance URL', () => {
  it('makes the request and shows the server’s refusal', async () => {
    const listed = vi.fn();
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.get('/api/v1/stock/items', () => {
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

    renderApp('/stock/items');

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
    expect(listed).toHaveBeenCalled();
  });
});
