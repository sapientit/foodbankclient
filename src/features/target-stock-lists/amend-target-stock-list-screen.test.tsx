import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from '../stock/queries';
import type { TargetStockList } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';
const STOCK_ITEMS = '/api/v1/stock/items';

const item = (
  over: Partial<StockItem> & Pick<StockItem, 'id' | 'name' | 'category'>,
): StockItem => ({
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  isActive: true,
  ...over,
});

const BEANS = item({ id: 's1', name: 'Baked beans 400g', category: 'Tinned' });
const MILK = item({ id: 's2', name: 'Long-life milk 1L', category: 'Dairy' });
const RICE = item({ id: 's3', name: 'Value rice 500g', category: 'Dry goods', isActive: false });
const CATALOGUE = [BEANS, MILK, RICE];

/** Names `s2` "UHT milk 1L" (renamed since), `s3` retired, `gone` no longer in the catalogue. */
const LIST: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [
    { stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 },
    { stockItemId: 's3', name: 'Value rice 500g', targetQuantity: 20 },
    { stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
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
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: CATALOGUE })),
  );
});

describe('amending a target stock list', () => {
  it('pre-fills the targets and shows a renamed item under its live name', async () => {
    renderApp('/stock/target-lists/t1');

    expect(await screen.findByLabelText('Target quantity for Baked beans 400g')).toHaveValue('48');
    const milk = screen.getByLabelText('Target quantity for Long-life milk 1L');
    expect(milk).toHaveValue('60');
    expect(screen.getByText(/was .UHT milk 1L., updated on save/)).toBeInTheDocument();
  });

  it('blocks saving while retired or missing lines remain, then unblocks once removed', async () => {
    renderApp('/stock/target-lists/t1');
    const user = userEvent.setup();

    const attention = await screen.findByRole('region', { name: 'Lines that need attention' });
    expect(
      within(attention).getByRole('button', { name: 'Remove Value rice 500g' }),
    ).toBeInTheDocument();
    expect(
      within(attention).getByRole('button', { name: 'Remove Instant coffee 200g' }),
    ).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/need attention/);

    await user.click(within(attention).getByRole('button', { name: 'Remove Value rice 500g' }));
    await user.click(within(attention).getByRole('button', { name: 'Remove Instant coffee 200g' }));

    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('region', { name: 'Lines that need attention' })).toBeNull();
  });

  it('moves focus to a rejected target box on a failed save', async () => {
    renderApp('/stock/target-lists/t1');
    const user = userEvent.setup();

    const attention = await screen.findByRole('region', { name: 'Lines that need attention' });
    await user.click(within(attention).getByRole('button', { name: 'Remove Value rice 500g' }));
    await user.click(within(attention).getByRole('button', { name: 'Remove Instant coffee 200g' }));

    const beans = screen.getByLabelText('Target quantity for Baked beans 400g');
    await user.clear(beans);
    await user.type(beans, 'lots');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the target quantity');
    expect(beans).toHaveFocus();
  });

  it('re-snapshots a renamed line and drops a cleared box on save', async () => {
    let patch: { name?: string; lines?: TargetStockList['lines'] } | null = null;
    server.use(
      http.patch(`${LISTS}/:id`, async ({ request }) => {
        patch = (await request.json()) as typeof patch;
        return HttpResponse.json({
          ...LIST,
          name: patch?.name ?? LIST.name,
          lines: patch?.lines ?? [],
        });
      }),
    );

    renderApp('/stock/target-lists/t1');
    const user = userEvent.setup();

    const attention = await screen.findByRole('region', { name: 'Lines that need attention' });
    await user.click(within(attention).getByRole('button', { name: 'Remove Value rice 500g' }));
    await user.click(within(attention).getByRole('button', { name: 'Remove Instant coffee 200g' }));

    await user.clear(screen.getByLabelText('Target quantity for Baked beans 400g'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Target stock lists' });
    expect(patch).toEqual({
      name: 'Standard week',
      lines: [{ stockItemId: 's2', name: 'Long-life milk 1L', targetQuantity: 60 }],
    });
  });
});
