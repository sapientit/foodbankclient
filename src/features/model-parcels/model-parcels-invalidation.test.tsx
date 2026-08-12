import { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from '../stock/queries';
import type { ModelParcel } from './queries';

/**
 * **Why `keys.ts` folds the list and the grid onto one root.**
 *
 * The grid's dropdown options are drawn from the model parcel list, so a
 * parcel just created has to be choosable on the grid screen the moment the
 * admin gets there — without this, "add a parcel, then put it on the grid" is
 * broken as a workflow, even though nothing on the grid screen itself
 * changed.
 *
 * This test builds its own query client with the app's real `staleTime`
 * rather than `renderApp`'s default of zero — see `stock-invalidation.test.tsx`
 * for why the default would make the assertion pass whether or not anything
 * was actually invalidated.
 */
const REFRESH = '/api/v1/auth/refresh';
const MODEL_PARCELS = '/api/v1/model-parcels';
const PARCEL_GRID = '/api/v1/parcel-grid';
const STOCK_ITEMS = '/api/v1/stock/items';

const BEANS: StockItem = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A1',
  isActive: true,
};

const SINGLE: ModelParcel = {
  id: 'p1',
  name: 'Single parcel',
  description: null,
  displayOrder: 0,
  contents: [{ stockItemId: BEANS.id, quantity: 2 }],
};

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: [BEANS] })),
  );
});

describe('one model-parcels key root', () => {
  it('makes a newly created parcel selectable on the grid without a page reload', async () => {
    let parcels: ModelParcel[] = [SINGLE];
    server.use(
      http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: parcels })),
      http.post(MODEL_PARCELS, async ({ request }) => {
        const body = (await request.json()) as { name: string; contents: unknown };
        const created: ModelParcel = {
          id: 'p2',
          name: body.name,
          description: null,
          displayOrder: 0,
          contents: body.contents as ModelParcel['contents'],
        };
        parcels = [...parcels, created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get(PARCEL_GRID, () =>
        HttpResponse.json({
          grid: {},
          cells: ['1-0'],
          isComplete: false,
          missingCells: ['1-0'],
          unknownParcels: [],
        }),
      ),
    );

    const { router } = renderApp('/model-parcels/new', cachingClient());
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Family parcel');
    await user.selectOptions(screen.getByLabelText('Add an item'), BEANS.id);
    await user.click(screen.getByRole('button', { name: 'Add model parcel' }));

    await screen.findByRole('heading', { name: 'Model parcels' });

    await router.navigate('/model-parcels/grid');

    /*
     * The cache is fresh for another minute, so "Family parcel" appearing as
     * a choice on a cell here can only happen if creating it invalidated the
     * same root the grid's list query reads from. Two disjoint roots — list
     * and grid as separate features — could not do that. Scoped to one cell:
     * every one of the thirty offers the same option, so an unscoped query
     * is ambiguous by construction.
     */
    const cell = await screen.findByRole('combobox', {
      name: 'Model parcel for 1 adult, 0 children',
    });
    expect(within(cell).getByRole('option', { name: 'Family parcel' })).toBeInTheDocument();
  });
});
