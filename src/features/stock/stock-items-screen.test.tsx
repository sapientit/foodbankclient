import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const ITEMS = '/api/v1/stock/items';

const BEANS: StockItem = { id: 's1', name: 'Baked beans', shelfNumber: 'A1', isActive: true };
const RICE: StockItem = { id: 's2', name: 'Rice', shelfNumber: 'B3', isActive: false };

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
  );
});

describe('stock-item maintenance', () => {
  it('lists active items and keeps retired ones behind an honest count', async () => {
    renderApp('/stock/items');

    expect(await screen.findByRole('row', { name: /Baked beans/ })).toHaveTextContent('A1');
    expect(screen.queryByText('Rice')).toBeNull();

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Show retired items (1)' }));

    expect(await screen.findByRole('row', { name: /Rice/ })).toHaveTextContent('Retired');
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('creates an item with only its name and shelf', async () => {
    let posted: unknown = null;
    server.use(
      http.post(ITEMS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { id: 's3', name: 'Pasta', shelfNumber: 'B1', isActive: true },
          { status: 201 },
        );
      }),
    );
    renderApp('/stock/items/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Pasta');
    await user.type(screen.getByLabelText('Shelf'), 'B1');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(posted).toEqual({ name: 'Pasta', shelfNumber: 'B1' });
    expect(await screen.findByRole('heading', { name: 'Stock items' })).toBeInTheDocument();
  });

  it('amends an item with only its name and shelf', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...BEANS, name: 'Beans', shelfNumber: 'A2' });
      }),
    );
    renderApp(`/stock/items/${BEANS.id}`);
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Beans');
    const shelf = screen.getByLabelText('Shelf');
    await user.clear(shelf);
    await user.type(shelf, 'A2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({ name: 'Beans', shelfNumber: 'A2' });
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

    expect(patched).toEqual({ name: 'Baked beans', shelfNumber: 'A4' });
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
