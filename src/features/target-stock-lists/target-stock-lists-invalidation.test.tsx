import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from '../stock/queries';
import type { TargetStockList } from './queries';

/**
 * **Why creating a list has to invalidate the same root the Shopping picker
 * reads.** "Set up the Christmas list, then go and shop against it" is broken as
 * a workflow if the new list is not in the picker until a reload.
 *
 * Builds its own query client with the app's real `staleTime` — under
 * `renderApp`'s default of zero every remount refetches and the assertion would
 * pass whether or not anything was invalidated. See `stock-invalidation.test.tsx`.
 */
const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';
const STOCK_ITEMS = '/api/v1/stock/items';
const STOCK_LEVELS = '/api/v1/stock/levels';

const BEANS: StockItem = {
  id: 's1',
  name: 'Baked beans 400g',
  category: 'Tinned',
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
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
    http.get(STOCK_LEVELS, () => HttpResponse.json({ items: [{ ...BEANS, quantityOnHand: 0 }] })),
  );
});

describe('one target-stock-lists key root', () => {
  it('makes a newly created list choosable on the Shopping screen without a reload', async () => {
    let lists: TargetStockList[] = [];
    server.use(
      http.get(LISTS, () => HttpResponse.json({ targetStockLists: lists })),
      http.post(LISTS, async ({ request }) => {
        const body = (await request.json()) as { name: string; lines: TargetStockList['lines'] };
        const created: TargetStockList = { id: 't-new', name: body.name, lines: body.lines };
        lists = [...lists, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { router } = renderApp('/stock/target-lists/new', cachingClient());
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Christmas');
    await user.type(await screen.findByLabelText('Target quantity for Baked beans 400g'), '96');
    await user.click(screen.getByRole('button', { name: 'Add target stock list' }));

    await screen.findByRole('heading', { name: 'Target stock lists' });

    await router.navigate('/stock/shopping');

    const picker = await screen.findByLabelText('Choose a target stock list');
    expect(screen.getByRole('option', { name: 'Christmas' })).toBeInTheDocument();
    expect(picker).toBeInTheDocument();
  });
});
