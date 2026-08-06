import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

/**
 * **The stock work is a team lead's job**, and the plan had this backwards until
 * it was settled: the team leader is the person standing in the warehouse, so
 * levels and stock takes are theirs. Only maintaining
 * the list of items — what exists at all — is admin-only, and that lives on
 * separate routes with its own `403` test.
 *
 * Its own file because `renderApp` fixes one signed-in actor per file:
 * `ensureSession()` is memoised per page load, and a test file is one module
 * registry.
 */

const BEANS: StockLevel = {
  id: 's2',
  name: 'Baked beans',
  shelfNumber: 'A2',
  isActive: true,
  quantityOnHand: 12,
};

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
    http.get('/api/v1/stock/levels', () => HttpResponse.json({ items: [BEANS] })),
  );
});

describe('a team lead', () => {
  it('sees the stock levels and the Stock link in their menu', async () => {
    renderApp('/stock');

    expect(await screen.findByRole('row', { name: /Baked beans/ })).toHaveTextContent('12');
    expect(screen.getByRole('link', { name: 'Stock' })).toBeInTheDocument();

    // Maintaining what items exist is the admin's, and is not offered here.
    expect(screen.queryByRole('link', { name: 'Stock items' })).toBeNull();
  });

  it('is offered the stock take, which is their warehouse job', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Baked beans/ });

    expect(screen.getByRole('link', { name: 'Stock take' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record a shop' })).toBeNull();
  });
});
