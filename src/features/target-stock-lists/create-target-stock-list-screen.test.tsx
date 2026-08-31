import { screen } from '@testing-library/react';
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
const MILK = item({ id: 's2', name: 'UHT milk 1L', category: 'Dairy' });
const RICE = item({ id: 's3', name: 'Value rice 500g', category: 'Dry goods', isActive: false });

const EXISTING: TargetStockList = { id: 't1', name: 'Standard week', lines: [] };

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(LISTS, () => HttpResponse.json({ targetStockLists: [EXISTING] })),
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: [BEANS, MILK, RICE] })),
  );
});

describe('adding a target stock list', () => {
  it('shows a target box for every active item and none for a retired one', async () => {
    renderApp('/stock/target-lists/new');

    expect(
      await screen.findByLabelText('Target quantity for Baked beans 400g'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Target quantity for UHT milk 1L')).toBeInTheDocument();
    expect(screen.queryByLabelText('Target quantity for Value rice 500g')).toBeNull();
  });

  it('saves only the items given a target, each with a name snapshot', async () => {
    let body: { name: string; lines: TargetStockList['lines'] } | null = null;
    server.use(
      http.post(LISTS, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(
          { id: 't2', name: body?.name, lines: body?.lines },
          { status: 201 },
        );
      }),
    );

    renderApp('/stock/target-lists/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Christmas');
    await user.type(screen.getByLabelText('Target quantity for Baked beans 400g'), '96');
    await user.click(screen.getByRole('button', { name: 'Add target stock list' }));

    await screen.findByRole('heading', { name: 'Target stock lists' });
    expect(body).toEqual({
      name: 'Christmas',
      lines: [{ stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 96 }],
    });
  });

  it('refuses a name already in use and links to that list', async () => {
    renderApp('/stock/target-lists/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Standard week');

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Amend that list' })).toHaveAttribute(
      'href',
      '/stock/target-lists/t1',
    );
    expect(screen.getByRole('button', { name: 'Add target stock list' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows a server field error against the name', async () => {
    server.use(
      http.post(LISTS, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Invalid',
              details: { issues: [{ path: 'name', message: 'That name is not allowed.' }] },
              requestId: 'r1',
            },
          },
          { status: 400 },
        ),
      ),
    );

    renderApp('/stock/target-lists/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Christmas');
    await user.type(screen.getByLabelText('Target quantity for Baked beans 400g'), '96');
    await user.click(screen.getByRole('button', { name: 'Add target stock list' }));

    expect(await screen.findByText('That name is not allowed.')).toBeInTheDocument();
  });
});
