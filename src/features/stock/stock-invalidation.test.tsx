import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem, StockLevel } from './queries';

/**
 * **The reason `stock-items/` was folded into `stock/` and onto one key root.**
 *
 * Items and levels are two lists of the same thing. Adding an item makes a row
 * appear in the levels list, and changing an item's shelf number **reorders**
 * it, because the server sorts on a derived shelf key. So an item mutation has
 * to invalidate levels — and with two disjoint key roots it cannot, which is a
 * levels screen showing the old shelf order to somebody walking the aisle.
 *
 * These tests build their own query client with the app's real `staleTime`
 * rather than taking `renderApp`'s default of zero. With `staleTime: 0` every
 * remount refetches and the assertion would pass whether anything was
 * invalidated or not — which is exactly the bug being guarded against.
 */

const REFRESH = '/api/v1/auth/refresh';
const ITEMS = '/api/v1/stock/items';
const LEVELS = '/api/v1/stock/levels';

const BEANS: StockItem = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A2',
  isActive: true,
};
const PASTA: StockItem = {
  id: 's2',
  name: 'Pasta',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A10',
  isActive: true,
};

function level(item: StockItem, quantityOnHand: number): StockLevel {
  return { ...item, quantityOnHand };
}

/** What the server's shelf sort would answer: the numeric run is compared as a number. */
function byShelf(items: readonly StockItem[]): StockItem[] {
  return [...items].sort((a, b) => {
    const [aLetters = '', aDigits = '0'] = /^(\D*)(\d*)/.exec(a.shelfNumber)?.slice(1) ?? [];
    const [bLetters = '', bDigits = '0'] = /^(\D*)(\d*)/.exec(b.shelfNumber)?.slice(1) ?? [];
    return aLetters === bLetters ? Number(aDigits) - Number(bDigits) : aLetters < bLetters ? -1 : 1;
  });
}

function rowNames(): (string | null)[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByRole('rowheader').textContent);
}

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The app's real policy. Without invalidation, a second visit inside the
      // minute serves the cache and asserts nothing.
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
  );
});

describe('one stock key root', () => {
  it('reorders the levels after an item’s shelf changes', async () => {
    let beans = BEANS;
    server.use(
      http.get(ITEMS, () => HttpResponse.json({ items: byShelf([beans, PASTA]) })),
      http.get(LEVELS, () =>
        HttpResponse.json({ items: byShelf([beans, PASTA]).map((item) => level(item, 12)) }),
      ),
      http.patch(`${ITEMS}/:id`, async ({ request }) => {
        const body = await request.json();
        if (typeof body === 'object' && body !== null && 'shelfNumber' in body) {
          beans = { ...beans, shelfNumber: String(body.shelfNumber) };
        }
        return HttpResponse.json(beans);
      }),
    );

    const { router } = renderApp('/stock', cachingClient());
    const user = userEvent.setup();

    await screen.findByRole('columnheader', { name: 'On hand' });
    expect(rowNames()).toEqual(['Baked beans', 'Pasta']);

    await router.navigate(`/stock/items/${BEANS.id}`);
    const shelfInput = await screen.findByLabelText('Shelf');
    await user.clear(shelfInput);
    await user.type(shelfInput, 'B9');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'Stock items' });

    await router.navigate('/stock');
    await screen.findByRole('columnheader', { name: 'On hand' });

    /*
     * The cache is fresh for another minute, so this order can only change if
     * the **item** mutation invalidated the **levels** query. Two disjoint key
     * roots — which is what this feature had before the fold — cannot do that,
     * and the failure is a picker sent down the aisle in the wrong order.
     */
    await waitFor(() => {
      expect(rowNames()).toEqual(['Pasta', 'Baked beans']);
    });
  });

  it('refetches the levels after a stock-take page is saved', async () => {
    // The cache is fresh for a minute, so this proves the save invalidates it.
    // A response body alone is not sufficient: returning to the levels screen
    // must show the figure that subsequent work is based on.
    let quantity = 12;
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [level(BEANS, quantity)] })),
      http.post('/api/v1/stock/take', () => {
        quantity = 9;
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: BEANS.id, quantityOnHand: quantity }],
        });
      }),
    );

    const { router } = renderApp('/stock', cachingClient());
    const user = userEvent.setup();

    expect(await screen.findByRole('row', { name: /Baked beans/ })).toHaveTextContent('12');

    await router.navigate('/stock/take');
    await user.type(await screen.findByLabelText('Counted Baked beans'), '9');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));
    await screen.findByText('One changed count saved.');

    await router.navigate('/stock');
    /*
     * The levels screen, not the count screen's baseline — that one also has a
     * `Baked beans` row containing a 9, and asserting against it would pass
     * whether or not anything was invalidated.
     */
    await screen.findByRole('columnheader', { name: 'On hand' });

    await waitFor(() => {
      expect(screen.getByRole('row', { name: /Baked beans/ })).toHaveTextContent('9');
    });
  });
});
