import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem, StockLevel } from '../stock/queries';
import type { TargetStockList } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';
const STOCK_LEVELS = '/api/v1/stock/levels';

const level = (
  over: Partial<StockLevel> &
    Pick<StockItem, 'id' | 'name' | 'category'> & { quantityOnHand: number },
): StockLevel => ({
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  isActive: true,
  ...over,
});

const LEVELS: StockLevel[] = [
  level({ id: 's1', name: 'Baked beans 400g', category: 'Tinned', quantityOnHand: 40 }),
  level({ id: 's2', name: 'Long-life milk 1L', category: 'Dairy', quantityOnHand: 10 }),
  level({
    id: 's3',
    name: 'Value rice 500g',
    category: 'Dry goods',
    quantityOnHand: 0,
    isActive: false,
  }),
  level({ id: 's4', name: 'Sugar 1kg', category: 'Baking', quantityOnHand: 15 }),
];

const LIST: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [
    { stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 },
    { stockItemId: 's3', name: 'Value rice 500g', targetQuantity: 20 },
    { stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
    { stockItemId: 's4', name: 'Sugar 1kg', targetQuantity: 10 },
  ],
};

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(LISTS, () => HttpResponse.json({ targetStockLists: [LIST] })),
    http.get(STOCK_LEVELS, () => HttpResponse.json({ items: LEVELS })),
  );
});

describe('the shopping screen', () => {
  it('shows only shortfalls, grouped by category, categories and items alphabetical', async () => {
    renderApp('/stock/shopping');
    const user = userEvent.setup();

    await user.selectOptions(
      await screen.findByLabelText('Choose a target stock list'),
      'Standard week',
    );

    const headings = await screen.findAllByRole('heading', { level: 3 });
    const categoryHeadings = headings
      .map((h) => h.textContent)
      .filter((t) => t === 'Dairy' || t === 'Tinned');
    expect(categoryHeadings).toEqual(['Dairy', 'Tinned']);

    expect(screen.getByRole('row', { name: /Long-life milk 1L/ })).toHaveTextContent('50');
    expect(screen.getByRole('row', { name: /Baked beans 400g/ })).toHaveTextContent('8');
    // Sugar is already above its target — not on the list.
    expect(screen.queryByRole('row', { name: /Sugar 1kg/ })).toBeNull();
  });

  it('flags a renamed item inline and lists retired and missing items as attention only', async () => {
    renderApp('/stock/shopping?list=t1');

    expect(await screen.findByText(/was .UHT milk 1L./)).toBeInTheDocument();

    const attention = screen.getByRole('region', {
      name: /Needs an administrator.s attention/,
    });
    expect(within(attention).getByRole('row', { name: /Value rice 500g/ })).toHaveTextContent('20');
    expect(within(attention).getByRole('row', { name: /Instant coffee 200g/ })).toHaveTextContent(
      '6',
    );

    expect(screen.getByText(/3 items need an administrator.s attention/)).toBeInTheDocument();
  });

  it('copies the list as tab-separated text and opens the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/stock/shopping?list=t1');

    await user.click(await screen.findByRole('button', { name: 'Copy to clipboard' }));

    const text = await navigator.clipboard.readText();
    expect(text).toContain('Dairy\nLong-life milk 1L\t50');
    expect(text).toContain('Tinned\nBaked beans 400g\t8');
    expect(text).toContain("Needs an administrator's attention — not bought\nValue rice 500g\t20");

    await user.click(screen.getByRole('button', { name: 'Open print dialog' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('counts a renamed-only list as needing attention while still buying the item', async () => {
    server.use(
      http.get(LISTS, () =>
        HttpResponse.json({
          targetStockLists: [
            {
              id: 't2',
              name: 'Renamed only',
              lines: [{ stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 }],
            },
          ],
        }),
      ),
    );

    renderApp('/stock/shopping?list=t2');

    // Bought — in its category group with the quantity.
    expect(await screen.findByRole('row', { name: /Long-life milk 1L/ })).toHaveTextContent('50');
    // And still counted for the administrator.
    expect(screen.getByText(/1 item needs an administrator.s attention/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Needs an administrator.s attention/ })).toBeNull();
  });

  it('says nothing is to be bought when the shortfalls are all retired or missing', async () => {
    server.use(
      http.get(LISTS, () =>
        HttpResponse.json({
          targetStockLists: [
            {
              id: 't3',
              name: 'All gone',
              lines: [
                { stockItemId: 's3', name: 'Value rice 500g', targetQuantity: 20 },
                { stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
              ],
            },
          ],
        }),
      ),
    );

    renderApp('/stock/shopping?list=t3');

    expect(await screen.findByText(/Nothing to buy from this list/)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /Needs an administrator.s attention/ }),
    ).toBeInTheDocument();
  });
});
