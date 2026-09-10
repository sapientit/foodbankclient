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
const GROUPING = { id: 'g1', name: 'Non-perishable' };
const FRESH_GROUPING = { id: 'g2', name: 'Fresh food' };

const BEANS: StockLevel = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A2',
  lowStockThreshold: null,
  groupingId: GROUPING.id,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
  quantityOnHand: 12,
};
const RICE: StockLevel = {
  id: 's2',
  name: 'Rice',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A10',
  lowStockThreshold: null,
  groupingId: GROUPING.id,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
  quantityOnHand: 4,
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
    http.get(LEVELS, () => HttpResponse.json({ items: [BEANS, RICE] })),
    http.get('/api/v1/stock/groupings', () => HttpResponse.json({ items: [GROUPING] })),
  );
});

async function chooseGrouping(user: ReturnType<typeof userEvent.setup>, groupingId = GROUPING.id) {
  await user.selectOptions(await screen.findByLabelText('Grouping'), groupingId);
}

function directLevels(count: number): StockLevel[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      ...BEANS,
      id: `item-${String(number)}`,
      name: `Item ${String(number)}`,
      shelfNumber: `Shelf ${String(number).padStart(3, '0')}`,
      quantityOnHand: number,
    };
  });
}

describe('saving a stock take page', () => {
  it('keeps a crate at combined row forty on page one and excludes an unsaved page-two count', async () => {
    const firstThirtyNine = directLevels(39);
    const jam: StockLevel = {
      ...BEANS,
      id: 'jam',
      name: 'Jam',
      groupingId: null,
    };
    const marmite: StockLevel = {
      ...BEANS,
      id: 'marmite',
      name: 'Marmite',
      groupingId: null,
    };
    const itemFortyOne: StockLevel = {
      ...BEANS,
      id: 'item-41',
      name: 'Item 41',
      shelfNumber: 'Shelf 041',
      quantityOnHand: 41,
    };
    const bodies: unknown[] = [];
    server.use(
      http.get(LEVELS, () =>
        HttpResponse.json({ items: [...firstThirtyNine, itemFortyOne, jam, marmite] }),
      ),
      http.get('/api/v1/stock/crates', () =>
        HttpResponse.json({
          items: [
            {
              id: 'c1',
              name: 'Tinned mix',
              shelfKey: 'Shelf 040',
              groupingId: GROUPING.id,
              sizePerCrate: 12,
              members: [
                {
                  stockItemId: jam.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
                {
                  stockItemId: marmite.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
              ],
            },
          ],
        }),
      ),
      http.post(TAKE, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: 'item-1', quantityOnHand: 99 }],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);

    expect(await screen.findByText('Page 1 of 2 — items 1–40 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(41);
    expect(screen.getAllByRole('rowheader').at(-1)).toHaveTextContent('Tinned mix');

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 2 — items 41–41 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    await user.type(screen.getByLabelText('Counted Item 41 individually'), '99');

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await user.type(screen.getByLabelText('Counted Item 1 individually'), '99');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('One changed count saved.')).toBeInTheDocument();
    expect(bodies).toEqual([
      { counts: [{ stockItemId: 'item-1', countedQuantity: 99 }], crateCounts: [] },
    ]);
  });

  it('returns to page one with no draft when the counter changes grouping', async () => {
    const levels = directLevels(41);
    const freshItem: StockLevel = {
      ...BEANS,
      id: 'fresh-1',
      name: 'Fresh item',
      groupingId: FRESH_GROUPING.id,
    };
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [...levels, freshItem] })),
      http.get('/api/v1/stock/groupings', () =>
        HttpResponse.json({ items: [GROUPING, FRESH_GROUPING] }),
      ),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await user.type(await screen.findByLabelText('Counted Item 41 individually'), '99');

    await chooseGrouping(user, FRESH_GROUPING.id);
    await chooseGrouping(user, GROUPING.id);

    expect(await screen.findByText('Page 1 of 2 — items 1–40 of 41.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Counted Item 41 individually')).toBeNull();
    expect(screen.getByLabelText('Counted Item 1 individually')).toHaveValue('');
  });

  it('saves one forty-row stock-take page without carrying an unsaved count to the next page', async () => {
    const levels = directLevels(41);
    const bodies: unknown[] = [];
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: levels })),
      http.post(TAKE, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: 'item-41', quantityOnHand: 99 }],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);

    expect(await screen.findByText('Page 1 of 2 — items 1–40 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(41);
    await user.type(screen.getByLabelText('Counted Item 1 individually'), '99');
    expect(screen.queryByLabelText('Counted Item 41 individually')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Page 2 of 2 — items 41–41 of 41.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await user.type(screen.getByLabelText('Counted Item 41 individually'), '99');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('One changed count saved.')).toBeInTheDocument();
    expect(bodies).toEqual([
      { counts: [{ stockItemId: 'item-41', countedQuantity: 99 }], crateCounts: [] },
    ]);
  });

  it('interleaves crates with direct items by their plain-string shelf labels and shows composition immediately', async () => {
    const cereal: StockLevel = {
      ...BEANS,
      id: 's3',
      name: 'Cereal',
      shelfNumber: 'A1',
    };
    const jam: StockLevel = {
      ...BEANS,
      id: 's4',
      name: 'Jam',
      groupingId: null,
      shelfNumber: 'A10',
    };
    const marmite: StockLevel = {
      ...BEANS,
      id: 's5',
      name: 'Marmite',
      groupingId: null,
      shelfNumber: 'A10',
    };
    const pasta: StockLevel = {
      ...BEANS,
      id: 's6',
      name: 'Pasta',
      shelfNumber: 'A2',
    };
    server.use(
      // Neither response array is in order; direct labels and crate shelf keys
      // compare as plain strings, so A10 comes before A2.
      http.get(LEVELS, () => HttpResponse.json({ items: [pasta, marmite, cereal, jam] })),
      http.get('/api/v1/stock/crates', () =>
        HttpResponse.json({
          items: [
            {
              id: 'c1',
              name: 'Tinned mix',
              shelfKey: 'A10',
              groupingId: GROUPING.id,
              sizePerCrate: 12,
              members: [
                {
                  stockItemId: jam.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
                {
                  stockItemId: marmite.id,
                  stockCompositionPercent: 50,
                  shoppingCompositionPercent: 50,
                },
              ],
            },
          ],
        }),
      ),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);

    expect((await screen.findAllByRole('rowheader')).map((header) => header.textContent)).toEqual([
      expect.stringContaining('Cereal'),
      expect.stringContaining('Tinned mix'),
      expect.stringContaining('Pasta'),
    ]);
    const composition = screen.getByRole('list', { name: 'Crate composition' });
    expect(within(composition).getByText('Jam: 50%')).toBeInTheDocument();
    expect(within(composition).getByText('Marmite: 50%')).toBeInTheDocument();
    expect(screen.queryByText(/Composition preview/)).toBeNull();
  });

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
    await chooseGrouping(user);

    await user.type(await screen.findByLabelText('Counted Baked beans individually'), '9');
    await user.type(screen.getByLabelText('Counted Rice individually'), '0');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('2 changed counts saved.')).toBeInTheDocument();
    expect(body).toEqual({
      counts: [
        { stockItemId: 's2', countedQuantity: 0 },
        { stockItemId: 's1', countedQuantity: 9 },
      ],
      crateCounts: [],
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
    await chooseGrouping(user);

    await user.type(await screen.findByLabelText('Counted Baked beans individually'), '12');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(
      await screen.findByText('Nothing changed in this grouping. Nothing was saved.'),
    ).toBeInTheDocument();
    expect(saves).toBe(0);
  });

  it('identifies an invalid count and links it to its explanation', async () => {
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);
    const input = await screen.findByLabelText('Counted Baked beans individually');

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
    await chooseGrouping(user);
    const input = await screen.findByLabelText('Counted Baked beans individually');

    await user.type(input, '9');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));
    await screen.findByText('One changed count saved.');

    await user.type(input, '9');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(
      await screen.findByText('Nothing changed in this grouping. Nothing was saved.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([
      { counts: [{ stockItemId: 's1', countedQuantity: 9 }], crateCounts: [] },
    ]);
  });

  it('can count a directly grouped packed item as individual units', async () => {
    let body: unknown = null;
    const boxedFormula: StockLevel = {
      ...BEANS,
      name: 'Baby formula - Stage 1',
      unitsPerPack: 24,
      packUnitLabel: 'boxes',
      quantityOnHand: 48,
    };
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [boxedFormula, RICE] })),
      http.post(TAKE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: boxedFormula.id, quantityOnHand: 37 }],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);

    const formulaRow = await screen.findByRole('row', { name: /Baby formula - Stage 1/ });
    const currentLevel = within(formulaRow).getAllByRole('cell')[1];
    expect(currentLevel).toHaveTextContent('48');
    expect(currentLevel).not.toHaveTextContent('individual units');
    expect(screen.getByText('or boxes of 24')).toBeVisible();

    await user.type(screen.getByLabelText('Counted Baby formula - Stage 1 individually'), '37');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('One changed count saved.')).toBeInTheDocument();
    expect(body).toEqual({
      counts: [{ stockItemId: boxedFormula.id, countedQuantity: 37 }],
      crateCounts: [],
    });
  });

  it('converts decimal boxes for a directly grouped packed item into its individual count', async () => {
    let body: unknown = null;
    const boxedFormula: StockLevel = {
      ...BEANS,
      name: 'Baby formula - Stage 1',
      unitsPerPack: 24,
      packUnitLabel: 'boxes',
      quantityOnHand: 48,
    };
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [boxedFormula, RICE] })),
      http.post(TAKE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          applied: 1,
          levels: [{ stockItemId: boxedFormula.id, quantityOnHand: 84 }],
        });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);

    const individualInput = await screen.findByLabelText(
      'Counted Baby formula - Stage 1 individually',
    );
    await user.type(screen.getByLabelText('Counted Baby formula - Stage 1 in boxes of 24'), '3.5');
    expect(individualInput).toHaveValue('84');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(await screen.findByText('One changed count saved.')).toBeInTheDocument();
    expect(body).toEqual({
      counts: [{ stockItemId: boxedFormula.id, countedQuantity: 84 }],
      crateCounts: [],
    });
  });

  it('requires a whole number in the individual count of a directly grouped packed item', async () => {
    let saves = 0;
    const boxedFormula: StockLevel = {
      ...BEANS,
      name: 'Baby formula - Stage 1',
      unitsPerPack: 24,
      packUnitLabel: 'boxes',
      quantityOnHand: 48,
    };
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [boxedFormula, RICE] })),
      http.post(TAKE, () => {
        saves += 1;
        return HttpResponse.json({ applied: 0, levels: [] });
      }),
    );
    renderApp('/stock/take');
    const user = userEvent.setup();
    await chooseGrouping(user);
    const individualInput = screen.getByLabelText('Counted Baby formula - Stage 1 individually');
    await user.type(individualInput, '3.5');
    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(individualInput).toHaveAttribute('aria-invalid', 'true');
    expect(individualInput).toHaveAccessibleDescription('Use a whole number of individual units.');
    expect(saves).toBe(0);
  });
});
