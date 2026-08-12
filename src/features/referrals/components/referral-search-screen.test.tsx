import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'admin@example.org', displayName: 'Admin', role: 'admin' },
      }),
    ),
  );
});

describe('administrator referral search', () => {
  it('posts supplied identifiers and shows only the deliberately minimal result fields', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/referrals/search', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          count: 1,
          results: [
            {
              referralId: 'r1',
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeAddress: '1 Elm Street',
              sessionDate: '2026-08-15',
              sessionLocation: 'St Mary’s Hall',
              status: 'active',
              matchedOn: ['postcode', 'phone'],
            },
          ],
        });
      }),
    );
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Postcode'), 'GU23 4XX');
    await user.type(screen.getByLabelText('Phone number'), '01483 123456');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('link', { name: 'Jamie Rowe' })).toHaveAttribute(
      'href',
      '/referrals/r1',
    );
    expect(screen.getByText('1 Elm Street')).toBeInTheDocument();
    expect(screen.getByText('Postcode, Phone number')).toBeInTheDocument();
    expect(body).toEqual({ postcode: 'GU23 4XX', phone: '01483 123456' });
  });

  it('will not search until an identifier has been supplied', async () => {
    renderApp('/referrals/search');
    expect(await screen.findByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('asks the administrator to narrow a search when the server capped the results', async () => {
    server.use(
      http.post('/api/v1/referrals/search', () => HttpResponse.json({ count: 51, results: [] })),
    );
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Postcode'), 'GU23 4XX');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Showing the first 0 results');
  });
});
