import { screen, within } from '@testing-library/react';
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
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get('/api/v1/stock/validation', () => HttpResponse.json({ issues: [] })),
  );
});

describe('stock validation', () => {
  it('groups the check outcome in a labelled results card', async () => {
    renderApp('/stock/validation');

    const results = await screen.findByRole('region', { name: 'Stock validation results' });
    expect(within(results).getByRole('status')).toHaveTextContent(
      'Stock setup is valid. Every item is counted exactly once.',
    );
  });
});
