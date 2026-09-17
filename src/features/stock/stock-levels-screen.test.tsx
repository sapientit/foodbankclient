import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LEVELS = '/api/v1/stock/levels';

/** The server orders visible shelf labels as plain strings: A1, A10, A2. */
const CEREAL: StockLevel = {
  id: 's1',
  name: 'Cereal',
  category: 'Breakfast',
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: 10,
  groupingId: null,
  unitsPerPack: 24,
  packUnitLabel: 'boxes',
  isActive: true,
  quantityOnHand: 40,
};
const BEANS: StockLevel = {
  id: 's2',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A2',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
  // Negative after a correction. Real, and not an error.
  quantityOnHand: -4,
};
const PASTA: StockLevel = {
  id: 's3',
  name: 'Pasta',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A10',
  lowStockThreshold: 3,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
  quantityOnHand: 0,
};
const SOUP: StockLevel = {
  id: 's4',
  name: 'Soup',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'B1',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
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
    http.get(LEVELS, () => HttpResponse.json({ items: [CEREAL, PASTA, BEANS, SOUP] })),
  );
});

describe('stock levels', () => {
  it('groups the stock list in a labelled results panel while keeping compact filters accessible', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Cereal/ });

    expect(screen.getByRole('heading', { name: 'Stock' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search items' })).toBeVisible();
    expect(screen.getByLabelText('Shelf filter')).toBeVisible();
    expect(screen.getByLabelText('Stock-level filter')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Stock results' })).toContainElement(
      screen.getByRole('table'),
    );
  });

  it('renders shelves in the order the server sent and never re-sorts them', async () => {
    renderApp('/stock');

    await screen.findByRole('row', { name: /Cereal/ });
    const shelves = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

    expect(shelves).toEqual(['A1', 'A10', 'A2']);
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

  it('makes an item below its watched threshold unmistakable', async () => {
    renderApp('/stock');

    const row = await screen.findByRole('row', { name: /Pasta/ });
    expect(within(row).getByText('Low stock')).toBeVisible();
    expect(screen.getByRole('row', { name: /Cereal/ })).not.toHaveTextContent('Low stock');
  });

  it('shows each level’s threshold or that it is not watched', async () => {
    renderApp('/stock');

    expect(await screen.findByRole('row', { name: /Cereal/ })).toHaveTextContent('10');
    expect(screen.getByRole('row', { name: /Baked beans/ })).toHaveTextContent('Not watched');
  });

  it('shows the packing description and one-decimal packing quantity where configured', async () => {
    renderApp('/stock');

    const cereal = await screen.findByRole('row', { name: /Cereal/ });
    expect(within(cereal).getByText('boxes')).toBeInTheDocument();
    expect(within(cereal).getByText('1.7')).toBeInTheDocument();

    const beans = screen.getByRole('row', { name: /Baked beans/ });
    const cells = within(beans).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('-');
    expect(cells[4]).toHaveTextContent('-');
  });

  it('shows active stock only, without a retired-items control', async () => {
    renderApp('/stock');

    expect(await screen.findByRole('row', { name: /Cereal/ })).toBeInTheDocument();
    expect(screen.queryByText('Soup')).toBeNull();

    expect(screen.queryByRole('checkbox', { name: /Show retired items/ })).toBeNull();
    expect(screen.queryByText(/weekly stock take resets/)).toBeNull();
  });

  it('filters to low stock, including a negative level without a watched threshold', async () => {
    renderApp('/stock');
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Stock-level filter'), 'low');

    expect(screen.getByRole('row', { name: /Pasta/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Baked beans/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Cereal/ })).toBeNull();
  });

  it('filters by the first shelf character without changing the server order', async () => {
    const flour: StockLevel = {
      ...BEANS,
      id: 's5',
      name: 'Flour',
      shelfNumber: 'B1',
      quantityOnHand: 12,
    };
    server.use(http.get(LEVELS, () => HttpResponse.json({ items: [CEREAL, PASTA, BEANS, flour] })));
    renderApp('/stock');
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Shelf filter'), 'B');

    expect(screen.getByRole('row', { name: /Flour/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Cereal/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /Baked beans/ })).toBeNull();
  });

  it('searches stock by item name without treating a shelf label as a match', async () => {
    renderApp('/stock');
    const user = userEvent.setup();

    await user.type(await screen.findByRole('searchbox', { name: 'Search items' }), 'a10');

    expect(screen.getByText('No matching stock items')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Pasta/ })).toBeNull();

    await user.clear(screen.getByRole('searchbox', { name: 'Search items' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search items' }), 'pasta');

    expect(screen.getByRole('row', { name: /Pasta/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Cereal/ })).toBeNull();
  });

  it('offers an administrator a hand adjustment for each stock item', async () => {
    renderApp('/stock');

    const row = await screen.findByRole('row', { name: /Baked beans/ });

    expect(screen.getByRole('button', { name: 'Adjust Baked beans stock' })).toBeInTheDocument();
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toContainElement(
      screen.getByRole('button', { name: 'Adjust Baked beans stock' }),
    );
    expect(cells[2]).toHaveTextContent('-4');
  });
});
