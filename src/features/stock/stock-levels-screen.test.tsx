import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LEVELS = '/api/v1/stock/levels';

/**
 * The order here is the server's, and it is the point of the fixture: a
 * zero-padded shelf key gives A1, A2, A10, which is the order a picker walks the
 * aisle in. Sorted as strings, A10 would come second.
 */
const CEREAL: StockLevel = {
  id: 's1',
  name: 'Cereal',
  shelfNumber: 'A1',
  isActive: true,
  quantityOnHand: 95,
};
const BEANS: StockLevel = {
  id: 's2',
  name: 'Baked beans',
  shelfNumber: 'A2',
  isActive: true,
  // Negative after a correction. Real, and not an error.
  quantityOnHand: -4,
};
const PASTA: StockLevel = {
  id: 's3',
  name: 'Pasta',
  shelfNumber: 'A10',
  isActive: true,
  quantityOnHand: 0,
};
const SOUP: StockLevel = {
  id: 's4',
  name: 'Soup',
  shelfNumber: 'B1',
  isActive: false,
  quantityOnHand: 7,
};

function session() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () => session()),
    http.get(LEVELS, () => HttpResponse.json({ items: [CEREAL, BEANS, PASTA, SOUP] })),
  );
});

describe('stock levels', () => {
  it('renders shelves in the order the server sent and never re-sorts them', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Cereal/ });
    const shelves = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

    // A naive sort() on shelfNumber would put A10 before A2.
    expect(shelves).toEqual(['A1', 'A2', 'A10']);
  });

  it('renders a negative quantity as a number, not as an error', async () => {
    renderApp('/stock');

    const row = await screen.findByRole('row', { name: /Baked beans/ });

    expect(within(row).getByText('-4')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a zero level rather than leaving the cell blank', async () => {
    renderApp('/stock');

    const row = await screen.findByRole('row', { name: /Pasta/ });

    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  it('keeps retired items behind a count that says how many are hidden', async () => {
    renderApp('/stock');

    expect(await screen.findByRole('row', { name: /Cereal/ })).toBeInTheDocument();
    expect(screen.queryByText('Soup')).toBeNull();

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Show retired items (1)' }));

    expect(await screen.findByRole('row', { name: /Soup/ })).toHaveTextContent('retired');
  });

  it('does not offer a hand adjustment', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Baked beans/ });

    expect(screen.queryByRole('link', { name: 'Adjust' })).toBeNull();
  });
});
