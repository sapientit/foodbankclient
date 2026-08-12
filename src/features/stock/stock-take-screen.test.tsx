import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LEVELS = '/api/v1/stock/levels';
const TAKE = '/api/v1/stock/take';

const BEANS: StockLevel = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A2',
  isActive: true,
  quantityOnHand: 12,
};
const RICE: StockLevel = {
  id: 's2',
  name: 'Rice',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A10',
  isActive: true,
  quantityOnHand: 4,
};

function levels(count: number): StockLevel[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${String(index + 1)}`,
    name: `Item ${String(index + 1)}`,
    category: 'Test',
    description: null,
    shelfNumber: `A${String(index + 1)}`,
    isActive: true,
    quantityOnHand: index + 1,
  }));
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
    http.get(LEVELS, () => HttpResponse.json({ items: [BEANS, RICE] })),
  );
});

describe('saving a stock take page', () => {
  it('sends only changed counts, including zero, to the one stock-take endpoint', async () => {
    let body: unknown = null;
    server.use(
      http.post(TAKE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          applied: 2,
          levels: [
            { stockItemId: BEANS.id, quantityOnHand: 9 },
            { stockItemId: RICE.id, quantityOnHand: 0 },
          ],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counted Baked beans'), '9');
    await user.type(screen.getByLabelText('Counted Rice'), '0');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('2 changed counts saved.')).toBeInTheDocument();
    expect(body).toEqual({
      counts: [
        { stockItemId: 's1', countedQuantity: 9 },
        { stockItemId: 's2', countedQuantity: 0 },
      ],
    });
  });

  it('does not post when every entered number matches the current level', async () => {
    let saves = 0;
    server.use(
      http.post(TAKE, () => {
        saves += 1;
        return HttpResponse.json({ applied: 0, levels: [] });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counted Baked beans'), '12');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(
      await screen.findByText('Nothing changed on this page. Nothing was saved.'),
    ).toBeInTheDocument();
    expect(saves).toBe(0);
  });

  it('identifies an invalid count and links it to its explanation', async () => {
    renderApp('/stock/take');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Counted Baked beans');

    await user.type(input, '-1');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('A count cannot be below zero.');
  });

  it('uses the server-confirmed level as the next save baseline', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(TAKE, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: BEANS.id, quantityOnHand: 9 }],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Counted Baked beans');

    await user.type(input, '9');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));
    await screen.findByText('One changed count saved.');

    await user.type(input, '9');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(
      await screen.findByText('Nothing changed on this page. Nothing was saved.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ counts: [{ stockItemId: 's1', countedQuantity: 9 }] }]);
  });
});

describe('stock take pagination', () => {
  it('shows forty shelf-ordered items per page and carries no counts between pages', async () => {
    server.use(http.get(LEVELS, () => HttpResponse.json({ items: levels(41) })));
    renderApp('/stock/take');
    const user = userEvent.setup();

    expect(await screen.findByText('Page 1 of 2 — items 1–40 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(41);
    expect(
      within(screen.getAllByRole('row')[1] ?? document.body).getByRole('rowheader'),
    ).toHaveTextContent('Item 1');
    expect(screen.queryByLabelText('Counted Item 41')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Page 2 of 2 — items 41–41 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByLabelText('Counted Item 41')).toBeInTheDocument();
  });
});
