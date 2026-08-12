import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from '../stock/queries';
import type { ModelParcel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const MODEL_PARCELS = '/api/v1/model-parcels';
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
  id: 'p2',
  name: 'Single parcel',
  description: null,
  displayOrder: 0,
  contents: [{ stockItemId: BEANS.id, quantity: 2 }],
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
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: [BEANS] })),
  );
});

describe('adding a model parcel', () => {
  it('creates the parcel with its contents and returns to the list', async () => {
    let posted: unknown = null;
    server.use(
      http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [] })),
      http.post(MODEL_PARCELS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { id: 'p9', name: 'Family parcel', description: null, displayOrder: 0, contents: [] },
          { status: 201 },
        );
      }),
    );

    renderApp('/model-parcels/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Family parcel');
    await user.selectOptions(screen.getByLabelText('Add an item'), BEANS.id);
    await user.clear(screen.getByLabelText('Quantity of Baked beans'));
    await user.type(screen.getByLabelText('Quantity of Baked beans'), '4');
    await user.click(screen.getByRole('button', { name: 'Add model parcel' }));

    expect(posted).toEqual({
      name: 'Family parcel',
      description: null,
      contents: [{ stockItemId: 's1', quantity: 4 }],
    });
    expect(await screen.findByRole('heading', { name: 'Model parcels' })).toBeInTheDocument();
  });

  it('refuses to submit with no contents, and names the reason', async () => {
    server.use(http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [] })));

    renderApp('/model-parcels/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Empty parcel');
    await user.click(screen.getByRole('button', { name: 'Add model parcel' }));

    expect(await screen.findByText('Add at least one item to this parcel.')).toBeInTheDocument();
  });

  it('offers to amend the existing parcel instead of creating a same-named duplicate', async () => {
    server.use(http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [SINGLE] })));

    renderApp('/model-parcels/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Single parcel');

    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add model parcel' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not treat a different-case name as a duplicate — the server does not fold case', async () => {
    server.use(http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [SINGLE] })));

    renderApp('/model-parcels/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'SINGLE PARCEL');

    expect(screen.queryByText(/already exists/)).toBeNull();
  });

  it('shows a conflict from the server verbatim when the pre-check could not have caught it', async () => {
    server.use(
      http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [] })),
      http.post(MODEL_PARCELS, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'A model parcel with that name already exists',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/model-parcels/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Family parcel');
    await user.selectOptions(screen.getByLabelText('Add an item'), BEANS.id);
    await user.click(screen.getByRole('button', { name: 'Add model parcel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A model parcel with that name already exists',
    );
  });
});
