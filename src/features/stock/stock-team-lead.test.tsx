import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

/**
 * **The stock work is a team lead's job**, and the plan had this backwards until
 * it was settled: the team leader is the person standing in the warehouse, so
 * levels, shops, stock takes and hand corrections are theirs. Only maintaining
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

  it('is offered the shop and the stock take, which are their jobs', async () => {
    // `openapi.yaml` says "Admin or team lead" on every endpoint behind both,
    // and the team leader is the person who did the shopping and is standing at
    // the shelf. Hiding either is hiding the work.
    renderApp('/stock');

    await screen.findByRole('row', { name: /Baked beans/ });

    expect(screen.getByRole('link', { name: 'Record a shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock take' })).toBeInTheDocument();
  });

  it('records a shop, which the server allows them to do', async () => {
    let posted: unknown = null;
    server.use(
      http.get('/api/v1/stock/search', () => HttpResponse.json({ items: [BEANS] })),
      http.post('/api/v1/stock/purchases', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ purchaseId: 'p1', lines: 1 }, { status: 201 });
      }),
    );
    renderApp('/stock/shop');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Find an item'), 'bak');
    await user.click(await screen.findByRole('button', { name: /^Add Baked beans/ }));
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    await screen.findByText('Shop recorded');
    expect(posted).toEqual({ lines: [{ stockItemId: 's2', quantity: 1 }] });
  });

  it('records a hand adjustment, which the server allows them to do', async () => {
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/stock/adjustments', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/stock');
    const user = userEvent.setup();

    const row = await screen.findByRole('row', { name: /Baked beans/ });
    await user.click(within(row).getByRole('link', { name: 'Adjust' }));

    await user.click(await screen.findByRole('radio', { name: /Correcting a mistake/ }));
    await user.type(screen.getByLabelText('How many'), '3');
    await user.type(screen.getByLabelText('Why'), 'Miscounted at the last stock take');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(posted).toEqual({
      stockItemId: 's2',
      quantityDelta: 3,
      movementType: 'correction',
      reason: 'Miscounted at the last stock take',
    });
  });
});
