import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';

describe('the Christmas voucher dates screen', () => {
  it('writes the inclusive start and end dates together', async () => {
    let saved: unknown;
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u1', email: 'admin@x.com', displayName: 'Ada Admin', role: 'admin' },
        }),
      ),
      http.get('/api/v1/voucher-config', () =>
        HttpResponse.json({ startDate: null, endDate: null }),
      ),
      http.put('/api/v1/voucher-config', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ startDate: '2026-12-01', endDate: '2026-12-24' });
      }),
    );

    renderApp('/voucher-config');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Voucher start date'), '2026-12-01');
    await user.type(screen.getByLabelText('Voucher end date'), '2026-12-24');
    await user.click(screen.getByRole('button', { name: 'Save voucher dates' }));

    await waitFor(() => {
      expect(saved).toEqual({ startDate: '2026-12-01', endDate: '2026-12-24' });
    });
  });
});
