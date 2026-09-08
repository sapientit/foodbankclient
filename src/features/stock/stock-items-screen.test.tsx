import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const ITEMS = '/api/v1/stock/items';
const GROUPING = { id: 'g1', name: 'Non-perishable' };

const BEANS: StockItem = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: 'In tomato sauce',
  shelfNumber: 'A1',
  shelfSortKey: 'A1',
  lowStockThreshold: 12,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
};
const RICE: StockItem = {
  id: 's2',
  name: 'Rice',
  category: 'Staples',
  description: null,
  shelfNumber: 'B3',
  shelfSortKey: 'B3',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: false,
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
    http.get(ITEMS, () => HttpResponse.json({ items: [BEANS, RICE] })),
    http.get('/api/v1/stock/groupings', () => HttpResponse.json({ items: [GROUPING] })),
  );
});

describe('stock-item maintenance', () => {
  it('lists active items by category then name, keeping a packed directly grouped item in its grouping', async () => {
    const boxedFormula: StockItem = {
      ...BEANS,
      name: 'Baby formula - Stage 1',
      groupingId: GROUPING.id,
      unitsPerPack: 24,
      packUnitLabel: 'boxes',
    };
    const apples: StockItem = {
      id: 's3',
      name: 'Apples',
      category: 'Fresh food',
      description: null,
      shelfNumber: 'C1',
      shelfSortKey: 'C1',
      lowStockThreshold: 5,
      groupingId: GROUPING.id,
      unitsPerPack: null,
      packUnitLabel: null,
      isActive: true,
    };
    server.use(http.get(ITEMS, () => HttpResponse.json({ items: [apples, boxedFormula, RICE] })));
    renderApp('/stock/items');

    const rows = await screen.findAllByRole('row');
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Apples'),
      expect.stringContaining('Baby formula - Stage 1'),
    ]);
    const formulaRow = screen.getByRole('row', { name: /Baby formula - Stage 1/ });
    expect(formulaRow).toHaveTextContent(
      'Tinned goodsIn tomato sauceA1Non-perishable24-unit boxes',
    );
    expect(within(formulaRow).getByText('Non-perishable')).toBeInTheDocument();
    expect(screen.queryByText('Rice')).toBeNull();

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Show retired items (1)' }));

    expect(await screen.findByRole('row', { name: /Rice/ })).toHaveTextContent('Retired');
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('says an item is counted by a crate only when a loaded crate actually names it', async () => {
    const crateMember: StockItem = {
      ...BEANS,
      id: 's3',
      name: 'Chickpeas',
      groupingId: null,
    };
    const crateCompanion: StockItem = {
      ...BEANS,
      id: 's4',
      name: 'Kidney beans',
      groupingId: null,
    };
    const unassigned: StockItem = {
      ...BEANS,
      id: 's5',
      name: 'Lentils',
      groupingId: null,
    };
    server.use(
      http.get(ITEMS, () =>
        HttpResponse.json({ items: [crateMember, crateCompanion, unassigned] }),
      ),
      http.get('/api/v1/stock/crates', () =>
        HttpResponse.json({
          items: [
            {
              id: 'c1',
              name: 'Tinned staple crate',
              shelfKey: 'A1',
              groupingId: GROUPING.id,
              sizePerCrate: 12,
              members: [
                {
                  stockItemId: crateMember.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
                {
                  stockItemId: crateCompanion.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
              ],
            },
          ],
        }),
      ),
    );
    renderApp('/stock/items');

    expect(await screen.findByRole('row', { name: /Chickpeas/ })).toHaveTextContent(
      'Counted by a crate',
    );
    expect(screen.getByRole('row', { name: /Lentils/ })).toHaveTextContent(
      'No stock-take grouping assigned',
    );
  });

  it('requires a category but leaves a blank description out of a new item', async () => {
    let posted: unknown = null;
    server.use(
      http.post(ITEMS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            id: 's3',
            name: 'Pasta',
            category: 'Staples',
            description: null,
            shelfNumber: 'B1',
            shelfSortKey: 'B1',
            lowStockThreshold: 8,
            groupingId: null,
            unitsPerPack: null,
            packUnitLabel: null,
            isActive: true,
          },
          { status: 201 },
        );
      }),
    );
    renderApp('/stock/items/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Pasta');
    await user.type(screen.getByLabelText('Shelf'), 'B1');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Enter a category.')).toBeVisible();
    expect(posted).toBeNull();

    await user.type(screen.getByLabelText('Category'), 'Staples');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(posted).toEqual({ name: 'Pasta', category: 'Staples', shelfNumber: 'B1' });
    expect(await screen.findByRole('heading', { name: 'Stock items' })).toBeInTheDocument();
  });

  it('amends an item with its category and optional description', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          ...BEANS,
          name: 'Beans',
          category: 'Tins',
          description: 'Reduced salt',
          shelfNumber: 'A2',
          shelfSortKey: 'A2',
        });
      }),
    );
    renderApp(`/stock/items/${BEANS.id}`);
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Beans');
    const category = screen.getByLabelText('Category');
    await user.clear(category);
    await user.type(category, 'Tins');
    const description = screen.getByLabelText('Description (optional)');
    await user.clear(description);
    await user.type(description, 'Reduced salt');
    const shelf = screen.getByLabelText('Shelf');
    await user.clear(shelf);
    await user.type(shelf, 'A2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({
      name: 'Beans',
      category: 'Tins',
      description: 'Reduced salt',
      shelfNumber: 'A2',
      lowStockThreshold: 12,
      groupingId: null,
      unitsPerPack: null,
      packUnitLabel: null,
    });
  });

  it('sends a threshold on create and clears it on amendment when blank', async () => {
    let posted: unknown = null;
    server.use(
      http.post(ITEMS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { ...BEANS, id: 's3', name: 'Pasta', lowStockThreshold: 8 },
          { status: 201 },
        );
      }),
    );
    renderApp('/stock/items/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Pasta');
    await user.type(screen.getByLabelText('Category'), 'Staples');
    await user.type(screen.getByLabelText('Shelf'), 'B1');
    await user.type(screen.getByLabelText('Low-stock threshold'), '8');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(posted).toEqual({
      name: 'Pasta',
      category: 'Staples',
      shelfNumber: 'B1',
      lowStockThreshold: 8,
    });
  });

  it('shows thresholds on the list and sends null to stop watching an item', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...BEANS, lowStockThreshold: null });
      }),
    );
    renderApp(`/stock/items/${BEANS.id}`);
    const user = userEvent.setup();

    const threshold = await screen.findByLabelText('Low-stock threshold');
    expect(threshold).toHaveValue('12');
    await user.clear(threshold);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({
      name: 'Baked beans',
      category: 'Tinned goods',
      description: 'In tomato sauce',
      shelfNumber: 'A1',
      lowStockThreshold: null,
      groupingId: null,
      unitsPerPack: null,
      packUnitLabel: null,
    });
  });

  /*
   * The duplicate-name checks below are not politeness. A duplicate name on
   * `POST /stock/items` is a clean `409`, but the same duplicate on
   * `PATCH /stock/items/{id}` is a **500** — verified against a running server,
   * which answers `INTERNAL_ERROR` and nothing else. So the check has to happen
   * before the request, and it has to include retired items, because a retired
   * row still holds its name and the server still refuses it.
   */
  it('catches a duplicate name before the request is made', async () => {
    const patched = vi.fn();
    server.use(
      http.patch(`${ITEMS}/:id`, () => {
        patched();
        return HttpResponse.json(BEANS);
      }),
    );
    renderApp(`/stock/items/${BEANS.id}`);
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Rice');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/already uses that name|still holds that name/)).toBeVisible();
    expect(patched).not.toHaveBeenCalled();
  });

  it('counts a retired item as still holding its name', async () => {
    renderApp('/stock/items/new');
    const user = userEvent.setup();

    // RICE is retired, so it is not on the list screen at all — which is why
    // the server's "already exists" would otherwise be a dead end.
    await user.type(await screen.findByLabelText('Name'), '  rice  ');

    expect(await screen.findByText(/retired and still holds that name/)).toBeVisible();
  });

  it('does not refuse an item the name it already has', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...BEANS, shelfNumber: 'A4' });
      }),
    );
    renderApp(`/stock/items/${BEANS.id}`);
    const user = userEvent.setup();

    const shelf = await screen.findByLabelText('Shelf');
    await user.clear(shelf);
    await user.type(shelf, 'A4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({
      name: 'Baked beans',
      category: 'Tinned goods',
      description: 'In tomato sauce',
      shelfNumber: 'A4',
      lowStockThreshold: 12,
      groupingId: null,
      unitsPerPack: null,
      packUnitLabel: null,
    });
  });

  it('makes retirement explicit and does not delete the item', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...BEANS, isActive: false });
      }),
    );
    renderApp('/stock/items');
    const user = userEvent.setup();

    const row = await screen.findByRole('row', { name: /Baked beans/ });
    await user.click(within(row).getByRole('button', { name: 'Retire' }));
    const dialog = screen.getByRole('dialog', { name: 'Retire Baked beans?' });
    expect(dialog).toHaveTextContent('does not delete the item');
    await user.click(within(dialog).getByRole('button', { name: 'Retire' }));

    expect(patched).toEqual({ isActive: false });
  });
});
