import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

const CRATE = {
  id: 'c1',
  name: 'Spread',
  shelfKey: 'A1',
  groupingId: 'g1',
  sizePerCrate: 12,
  members: [
    { stockItemId: 'jam', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
    { stockItemId: 'marmite', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
  ],
};

const FLOUR = {
  id: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  groupingId: 'g1',
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
};

const SUGAR = {
  ...FLOUR,
  id: 'sugar',
  name: 'Sugar',
};

const RICE = {
  ...FLOUR,
  id: 'rice',
  name: 'Rice',
};

const FLOUR_SR = {
  ...FLOUR,
  id: 'flour-sr',
  name: 'Flour: SR',
  isActive: false,
};

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@example.test', displayName: 'Pete', role: 'admin' },
      }),
    ),
    http.get('/api/v1/stock/crates', () => HttpResponse.json({ items: [CRATE] })),
    http.get('/api/v1/stock/groupings', () =>
      HttpResponse.json({ items: [{ id: 'g1', name: 'Non-perishable' }] }),
    ),
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    http.get('/api/v1/stock/levels', () => HttpResponse.json({ items: [] })),
  );
});

describe('crate deletion', () => {
  it('asks for an explicit, named confirmation before deleting a crate', async () => {
    renderApp('/stock/crates');
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Edit Spread' })).toHaveAttribute(
      'title',
      'Edit Spread',
    );
    expect(screen.getByRole('button', { name: 'Edit Spread' })).toHaveClass('button-plain');
    expect(screen.getByRole('button', { name: 'Delete Spread' })).toHaveClass(
      'button-danger',
      'button-plain',
    );
    await user.click(screen.getByRole('button', { name: 'Delete Spread' }));
    expect(screen.getByRole('heading', { name: 'Delete Spread?' })).toBeInTheDocument();
    expect(screen.getByText(/Target lists that name it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete Spread?' })).toBeNull();
  });

  it('treats the documented empty delete response as success and restores direct grouping', async () => {
    const groupingPatches: unknown[] = [];
    server.use(
      http.delete('/api/v1/stock/crates/:id', () => new HttpResponse(null, { status: 204 })),
      http.patch('/api/v1/stock/items/:id', async ({ params, request }) => {
        groupingPatches.push({ id: params.id, body: await request.json() });
        return HttpResponse.json(FLOUR);
      }),
    );
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Spread' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Spread?' })).getByRole('button', {
        name: 'Delete Spread',
      }),
    );

    await waitFor(() => {
      expect(groupingPatches).toEqual([
        { id: 'jam', body: { groupingId: 'g1' } },
        { id: 'marmite', body: { groupingId: 'g1' } },
      ]);
    });
    expect(screen.queryByRole('heading', { name: 'Delete Spread?' })).toBeNull();
    expect(
      screen.queryByText('The server returned no content where a body was expected.'),
    ).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Deleted Spread.');
    expect(screen.getByRole('button', { name: 'Add crate' })).toHaveFocus();
  });
});

describe('crate composition inputs', () => {
  it('does not offer a shelf or retired item when it has only one active stock item', async () => {
    server.use(
      http.get('/api/v1/stock/crates', () => HttpResponse.json({ items: [] })),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [FLOUR, FLOUR_SR] })),
    );
    renderApp('/stock/crates');

    const shelf = await screen.findByLabelText('Shelf');
    expect(within(shelf).queryByRole('option', { name: 'A1' })).toBeNull();
    expect(screen.queryByText('Flour: SR')).toBeNull();
  });

  it('keeps a retired existing member visible while its crate is being amended', async () => {
    const crateWithRetiredMember = {
      ...CRATE,
      members: [
        { stockItemId: 'flour', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
        {
          stockItemId: 'flour-sr',
          stockCompositionPercent: 50,
          shoppingCompositionPercent: 50,
        },
      ],
    };
    server.use(
      http.get('/api/v1/stock/crates', () =>
        HttpResponse.json({ items: [crateWithRetiredMember] }),
      ),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [FLOUR, FLOUR_SR] })),
    );
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Spread' }));

    const retiredRow = screen.getByRole('row', { name: /Flour: SR/ });
    expect(within(retiredRow).getByRole('checkbox', { name: 'Include' })).toBeChecked();
  });

  it('retains a retired member after switching the edited crate to another shelf and back', async () => {
    const crateWithRetiredMember = {
      ...CRATE,
      members: [
        { stockItemId: 'flour', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
        {
          stockItemId: 'flour-sr',
          stockCompositionPercent: 50,
          shoppingCompositionPercent: 50,
        },
      ],
    };
    const patchBodies: unknown[] = [];
    server.use(
      http.get('/api/v1/stock/crates', () =>
        HttpResponse.json({ items: [crateWithRetiredMember] }),
      ),
      http.get('/api/v1/stock/items', () =>
        HttpResponse.json({
          items: [FLOUR, FLOUR_SR, { ...SUGAR, shelfNumber: 'B1' }, { ...RICE, shelfNumber: 'B1' }],
        }),
      ),
      http.patch('/api/v1/stock/crates/:id', async ({ request }) => {
        patchBodies.push(await request.json());
        return HttpResponse.json(crateWithRetiredMember);
      }),
    );
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Spread' }));
    await user.selectOptions(screen.getByLabelText('Shelf'), 'B1');
    await user.selectOptions(screen.getByLabelText('Shelf'), 'A1');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(patchBodies).toEqual([
        {
          name: 'Spread',
          shelfKey: 'A1',
          groupingId: 'g1',
          sizePerCrate: 12,
          members: [
            { stockItemId: 'flour', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
            {
              stockItemId: 'flour-sr',
              stockCompositionPercent: 50,
              shoppingCompositionPercent: 50,
            },
          ],
        },
      ]);
    });
  });

  it('uses the column headings visually while retaining hidden labels for assistive technology', async () => {
    server.use(http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [FLOUR, SUGAR] })));
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Spread' }));

    expect(screen.getByRole('columnheader', { name: 'Stock %' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Shopping %' })).toBeInTheDocument();
    expect(screen.getByLabelText('Stock percentage for Flour')).toBeInTheDocument();
    expect(screen.getByLabelText('Shopping percentage for Flour')).toBeInTheDocument();
    expect(screen.getByText('Stock percentage for Flour').className).toMatch(/visuallyHidden/);
    expect(screen.getByText('Shopping percentage for Flour').className).toMatch(/visuallyHidden/);
  });

  it('clears direct grouping as soon as items become crate members', async () => {
    const groupingPatches: unknown[] = [];
    server.use(
      http.get('/api/v1/stock/crates', () => HttpResponse.json({ items: [] })),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [FLOUR, SUGAR] })),
      http.post('/api/v1/stock/crates', () =>
        HttpResponse.json({ ...CRATE, id: 'c2', name: 'Baking crate' }, { status: 201 }),
      ),
      http.patch('/api/v1/stock/items/:id', async ({ params, request }) => {
        groupingPatches.push({ id: params.id, body: await request.json() });
        return HttpResponse.json(FLOUR);
      }),
    );
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Baking crate');
    await user.selectOptions(screen.getByLabelText('Shelf'), 'A1');
    await user.selectOptions(screen.getByLabelText('Stock-take grouping'), 'g1');
    await user.type(screen.getByLabelText('Units per crate'), '12');
    for (const checkbox of screen.getAllByRole('checkbox', { name: 'Include' }))
      await user.click(checkbox);
    await user.type(screen.getByLabelText('Stock percentage for Flour'), '50');
    await user.type(screen.getByLabelText('Shopping percentage for Flour'), '50');
    await user.type(screen.getByLabelText('Stock percentage for Sugar'), '50');
    await user.type(screen.getByLabelText('Shopping percentage for Sugar'), '50');
    await user.click(screen.getByRole('button', { name: 'Add crate' }));

    await waitFor(() => {
      expect(groupingPatches).toEqual([
        { id: 'flour', body: { groupingId: null } },
        { id: 'sugar', body: { groupingId: null } },
      ]);
    });
  });

  it('restores a removed member to the crate grouping for direct counting', async () => {
    const threeMemberCrate = {
      ...CRATE,
      members: [
        { stockItemId: 'flour', stockCompositionPercent: 34, shoppingCompositionPercent: 34 },
        { stockItemId: 'sugar', stockCompositionPercent: 33, shoppingCompositionPercent: 33 },
        { stockItemId: 'rice', stockCompositionPercent: 33, shoppingCompositionPercent: 33 },
      ],
    };
    const groupingPatches: unknown[] = [];
    server.use(
      http.get('/api/v1/stock/crates', () => HttpResponse.json({ items: [threeMemberCrate] })),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [FLOUR, SUGAR, RICE] })),
      http.patch('/api/v1/stock/crates/:id', () => HttpResponse.json(threeMemberCrate)),
      http.patch('/api/v1/stock/items/:id', async ({ params, request }) => {
        groupingPatches.push({ id: params.id, body: await request.json() });
        return HttpResponse.json(FLOUR);
      }),
    );
    renderApp('/stock/crates');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Spread' }));
    await user.click(
      within(screen.getByRole('row', { name: /Flour/ })).getByRole('checkbox', { name: 'Include' }),
    );
    for (const item of ['Sugar', 'Rice']) {
      const stock = screen.getByLabelText(`Stock percentage for ${item}`);
      const shopping = screen.getByLabelText(`Shopping percentage for ${item}`);
      await user.clear(stock);
      await user.type(stock, '50');
      await user.clear(shopping);
      await user.type(shopping, '50');
    }
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(groupingPatches).toEqual([{ id: 'flour', body: { groupingId: 'g1' } }]);
    });
  });
});
