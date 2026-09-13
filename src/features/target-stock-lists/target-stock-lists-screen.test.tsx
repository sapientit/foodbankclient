import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { TargetStockList } from './queries';

/** Signed in as Pete, an administrator. See `test/render-app.tsx`. */
const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';

const STANDARD: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [
    { kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { kind: 'item', stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 },
  ],
};
const CHRISTMAS: TargetStockList = {
  id: 't2',
  name: 'Christmas',
  lines: [{ kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 96 }],
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
  );
});

describe('the target stock lists screen', () => {
  it('lists each list, ordered by name, with its line count', async () => {
    server.use(
      http.get(LISTS, () => HttpResponse.json({ targetStockLists: [STANDARD, CHRISTMAS] })),
    );

    renderApp('/stock/target-lists');

    const rows = await screen.findAllByRole('rowheader');
    expect(rows.map((row) => row.textContent)).toEqual(['Christmas', 'Standard week']);
    expect(screen.getByRole('row', { name: /Standard week/ })).toHaveTextContent('2');
  });

  it('offers a way to add a list when there are none', async () => {
    server.use(http.get(LISTS, () => HttpResponse.json({ targetStockLists: [] })));

    renderApp('/stock/target-lists');

    expect(
      await screen.findByRole('heading', { name: 'No target stock lists yet' }),
    ).toBeInTheDocument();
  });

  it('deletes a list through the confirmation dialog', async () => {
    const deleted = vi.fn();
    let lists = [STANDARD, CHRISTMAS];
    server.use(
      http.get(LISTS, () => HttpResponse.json({ targetStockLists: lists })),
      http.delete(`${LISTS}/:id`, ({ params }) => {
        deleted(params.id);
        lists = lists.filter((list) => list.id !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp('/stock/target-lists');
    const user = userEvent.setup();

    await screen.findByRole('rowheader', { name: 'Christmas' });
    const christmasRow = screen.getByRole('row', { name: /Christmas/ });
    await user.click(within(christmasRow).getByRole('button', { name: 'Delete Christmas' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleted).toHaveBeenCalledWith('t2');
    await screen.findByRole('rowheader', { name: 'Standard week' });
    expect(screen.queryByRole('rowheader', { name: 'Christmas' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Deleted Christmas.');
    expect(screen.getByRole('link', { name: 'Add a target stock list' })).toHaveFocus();
  });

  it('gives compact list actions their item-specific names', async () => {
    server.use(http.get(LISTS, () => HttpResponse.json({ targetStockLists: [STANDARD] })));
    renderApp('/stock/target-lists');

    const row = await screen.findByRole('row', { name: /Standard week/ });
    expect(within(row).getByRole('link', { name: 'Amend Standard week' })).toHaveAttribute(
      'title',
      'Amend Standard week',
    );
    expect(within(row).getByRole('button', { name: 'Delete Standard week' })).toHaveAttribute(
      'title',
      'Delete Standard week',
    );
  });
});
