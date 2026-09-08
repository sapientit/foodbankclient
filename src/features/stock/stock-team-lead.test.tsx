import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A2',
  shelfSortKey: 'A2',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
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
    expect(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', {
        name: 'Stock',
      }),
    ).toBeInTheDocument();

    // Maintaining what items exist is the admin's, and is not offered here.
    expect(screen.queryByRole('link', { name: 'Stock items' })).toBeNull();
  });

  it('is offered the stock take, which is their warehouse job', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Baked beans/ });

    expect(
      within(screen.getByRole('navigation', { name: 'Section navigation' })).getByRole('link', {
        name: 'Stock take',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record a shop' })).toBeNull();
  });

  it('sets an individual item’s level by converting the fresh level into the correction delta', async () => {
    let correction: unknown = null;
    server.use(
      http.post('/api/v1/stock/items/:id/corrections', async ({ request }) => {
        correction = await request.json();
        return HttpResponse.json({ quantityOnHand: 9 });
      }),
    );
    renderApp('/stock');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Adjust Baked beans stock' }));
    expect(screen.getByRole('combobox', { name: 'Operation' })).toHaveValue('set');
    const quantity = screen.getByLabelText('Stock level');
    await user.clear(quantity);
    await user.type(quantity, '9');
    await user.click(screen.getByRole('button', { name: 'Save stock change' }));

    await waitFor(() => {
      expect(correction).toEqual({ quantityDelta: -3 });
    });
  });

  it('adds and reduces the entered amount rather than treating it as a stock total', async () => {
    const corrections: unknown[] = [];
    server.use(
      http.post('/api/v1/stock/items/:id/corrections', async ({ request }) => {
        corrections.push(await request.json());
        return HttpResponse.json({ quantityOnHand: 17 });
      }),
    );
    renderApp('/stock');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Adjust Baked beans stock' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'add');
    await user.type(screen.getByLabelText('Amount to add'), '5');
    await user.click(screen.getByRole('button', { name: 'Save stock change' }));
    await waitFor(() => {
      expect(corrections).toEqual([{ quantityDelta: 5 }]);
    });

    await user.click(await screen.findByRole('button', { name: 'Adjust Baked beans stock' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'reduce');
    await user.type(screen.getByLabelText('Amount to reduce'), '2');
    await user.click(screen.getByRole('button', { name: 'Save stock change' }));
    await waitFor(() => {
      expect(corrections).toEqual([{ quantityDelta: 5 }, { quantityDelta: -2 }]);
    });
  });
});
