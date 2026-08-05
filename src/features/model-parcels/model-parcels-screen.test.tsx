import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { ModelParcel } from './queries';

/** Signed in as Pete, an administrator. See `test/render-app.tsx`. */
const REFRESH = '/api/v1/auth/refresh';
const MODEL_PARCELS = '/api/v1/model-parcels';

const FAMILY: ModelParcel = {
  id: 'p1',
  name: 'Family parcel',
  description: 'For 3 or more',
  displayOrder: 0,
  contents: [{ stockItemId: 's1', quantity: 4 }],
};

const SINGLE: ModelParcel = {
  id: 'p2',
  name: 'Single parcel',
  description: null,
  displayOrder: 1,
  contents: [{ stockItemId: 's1', quantity: 2 }],
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

describe('the model parcels list', () => {
  it('lists every parcel with its item count', async () => {
    server.use(
      http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [FAMILY, SINGLE] })),
    );

    renderApp('/model-parcels');

    expect(await screen.findByRole('rowheader', { name: 'Family parcel' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Single parcel' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Family parcel/ })).toHaveTextContent('1');
  });

  it('offers no retire toggle — a model parcel has no isActive field, only delete', async () => {
    server.use(http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [FAMILY] })));

    renderApp('/model-parcels');

    await screen.findByRole('rowheader', { name: 'Family parcel' });
    expect(screen.queryByRole('button', { name: /Retire/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reactivate/ })).toBeNull();
  });

  it('deletes a parcel that nothing references', async () => {
    let deleted = false;
    server.use(
      http.get(MODEL_PARCELS, () =>
        HttpResponse.json({ modelParcels: deleted ? [SINGLE] : [FAMILY, SINGLE] }),
      ),
      http.delete(`${MODEL_PARCELS}/:id`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp('/model-parcels');
    const user = userEvent.setup();

    const row = await screen.findByRole('row', { name: /Family parcel/ });
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete Family parcel?' }));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'Family parcel' })).toBeNull();
    });
  });

  it('shows the server’s refusal verbatim when the grid still uses the parcel', async () => {
    server.use(
      http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [FAMILY] })),
      http.delete(`${MODEL_PARCELS}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That model parcel is still used by the household grid',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/model-parcels');
    const user = userEvent.setup();

    await screen.findByRole('rowheader', { name: 'Family parcel' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete Family parcel?' }));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That model parcel is still used by the household grid',
    );
    // Still in the list — the delete did not happen.
    expect(screen.getByRole('rowheader', { name: 'Family parcel' })).toBeInTheDocument();
  });
});
