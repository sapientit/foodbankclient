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
const RICE: StockItem = {
  id: 's2',
  name: 'Rice',
  category: 'Dry goods',
  description: null,
  shelfNumber: 'A2',
  isActive: true,
};

const FAMILY: ModelParcel = {
  id: 'p1',
  name: 'Family parcel',
  description: 'For 3 or more',
  displayOrder: 0,
  contents: [{ stockItemId: BEANS.id, quantity: 4 }],
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
    http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [FAMILY] })),
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: [BEANS, RICE] })),
  );
});

describe('amending a model parcel', () => {
  it('shows the name as static text, not an editable field', async () => {
    renderApp(`/model-parcels/${FAMILY.id}`);

    await screen.findByRole('heading', { name: 'Amend Family parcel' });
    expect(screen.getByText('Family parcel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /name/i })).toBeNull();
  });

  it('sends no name field on save — the server silently strips one if it arrives', async () => {
    let posted: unknown = null;
    server.use(
      http.patch(`${MODEL_PARCELS}/:id`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...FAMILY, description: 'Updated' });
      }),
    );

    renderApp(`/model-parcels/${FAMILY.id}`);
    const user = userEvent.setup();

    const description = await screen.findByLabelText('Description (optional)');
    await user.clear(description);
    await user.type(description, 'Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Model parcels' });
    expect(posted).toEqual({
      description: 'Updated',
      contents: [{ stockItemId: BEANS.id, quantity: 4 }],
    });
    expect(posted).not.toHaveProperty('name');
  });

  it('loads the existing contents with names resolved from the stock item list', async () => {
    renderApp(`/model-parcels/${FAMILY.id}`);

    expect(await screen.findByRole('rowheader', { name: 'Baked beans' })).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity of Baked beans')).toHaveValue('4');
  });

  it('adds and removes contents lines before saving', async () => {
    let posted: unknown = null;
    server.use(
      http.patch(`${MODEL_PARCELS}/:id`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(FAMILY);
      }),
    );

    renderApp(`/model-parcels/${FAMILY.id}`);
    const user = userEvent.setup();

    await screen.findByLabelText('Quantity of Baked beans');
    await user.selectOptions(screen.getByLabelText('Add an item'), RICE.id);
    await user.click(screen.getByRole('button', { name: 'Remove Baked beans' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Model parcels' });
    expect(posted).toEqual({
      description: 'For 3 or more',
      contents: [{ stockItemId: RICE.id, quantity: 1 }],
    });
  });

  it('shows an empty-state when the id is not in the list rather than crashing', async () => {
    renderApp('/model-parcels/does-not-exist');

    expect(await screen.findByText('That model parcel is not in the list')).toBeInTheDocument();
  });
});
