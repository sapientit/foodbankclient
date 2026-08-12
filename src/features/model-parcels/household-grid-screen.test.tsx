import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from '../stock/queries';
import type { ModelParcel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const MODEL_PARCELS = '/api/v1/model-parcels';
const PARCEL_GRID = '/api/v1/parcel-grid';
const PREVIEW = '/api/v1/parcel-grid/preview';
const STOCK_ITEMS = '/api/v1/stock/items';

const BEANS: StockItem = {
  id: 's1',
  name: 'Baked beans',
  category: 'Tinned goods',
  description: null,
  shelfNumber: 'A1',
  isActive: true,
};

const FAMILY: ModelParcel = {
  id: 'p1',
  name: 'Family parcel',
  description: null,
  displayOrder: 0,
  contents: [{ stockItemId: BEANS.id, quantity: 4 }],
};

const SINGLE: ModelParcel = {
  id: 'p2',
  name: 'Single parcel',
  description: null,
  displayOrder: 1,
  contents: [{ stockItemId: BEANS.id, quantity: 2 }],
};

const COMPLETE_GRID: Record<string, string> = Object.fromEntries(
  [
    '1-0',
    '1-1',
    '1-2',
    '1-3',
    '1-4',
    '1-5',
    '2-0',
    '2-1',
    '2-2',
    '2-3',
    '2-4',
    '2-5',
    '3-0',
    '3-1',
    '3-2',
    '3-3',
    '3-4',
    '3-5',
    '4-0',
    '4-1',
    '4-2',
    '4-3',
    '4-4',
    '4-5',
    '5-0',
    '5-1',
    '5-2',
    '5-3',
    '5-4',
    '5-5',
  ].map((key) => [key, 'Single parcel']),
);

function gridResponse(grid: Record<string, string>) {
  const cells = Object.keys(COMPLETE_GRID);
  const missingCells = cells.filter((key) => !(key in grid));
  return HttpResponse.json({
    grid,
    cells,
    isComplete: missingCells.length === 0,
    missingCells,
    unknownParcels: [],
  });
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
    http.get(MODEL_PARCELS, () => HttpResponse.json({ modelParcels: [FAMILY, SINGLE] })),
    http.get(STOCK_ITEMS, () => HttpResponse.json({ items: [BEANS] })),
  );
});

describe('the household grid', () => {
  it('saves the whole grid in one PUT rather than one call per cell', async () => {
    let putCount = 0;
    let putGrid: unknown = null;
    server.use(
      http.get(PARCEL_GRID, () => gridResponse(COMPLETE_GRID)),
      http.put(PARCEL_GRID, async ({ request }) => {
        putCount += 1;
        const body: unknown = await request.json();
        putGrid = typeof body === 'object' && body !== null && 'grid' in body ? body.grid : null;
        // Verified against a running server: a successful PUT echoes the
        // saved grid back rather than answering with an empty body, even
        // though `openapi.yaml` declares this response with no content at
        // all. `useSaveParcelGrid` discards it either way — see the comment
        // there — but a fixture with a genuinely empty body makes
        // `openapi-fetch` try to JSON-parse nothing and reject, which is not
        // what the real endpoint does.
        return HttpResponse.json({ grid: putGrid });
      }),
    );

    renderApp('/model-parcels/grid');
    const user = userEvent.setup();

    // Change two different cells before saving.
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Model parcel for 1 adult, 0 children' }),
      'Family parcel',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Model parcel for 5 adults, 5 children' }),
      'Family parcel',
    );

    // No request yet — nothing is sent per cell.
    expect(putCount).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Save the grid' }));

    await waitFor(() => {
      expect(putCount).toBe(1);
    });
    expect(putGrid).toEqual({ ...COMPLETE_GRID, '1-0': 'Family parcel', '5-5': 'Family parcel' });
    expect(await screen.findByText('Grid saved.')).toBeInTheDocument();
  });

  it('renders a cell naming a deleted parcel without crashing, and flags it', async () => {
    server.use(http.get(PARCEL_GRID, () => gridResponse({ '1-0': 'Deleted parcel' })));

    renderApp('/model-parcels/grid');

    expect(
      await screen.findByText(/1 cell names a model parcel that no longer exists\./),
    ).toBeInTheDocument();

    const cell = screen.getByRole('combobox', { name: 'Model parcel for 1 adult, 0 children' });
    expect(cell).toHaveValue('Deleted parcel');
    expect(
      screen.getByRole('option', { name: 'Deleted parcel (no longer exists)' }),
    ).toBeInTheDocument();
  });

  it('shows a partly filled grid as information rather than an error', async () => {
    server.use(http.get(PARCEL_GRID, () => gridResponse({ '1-0': 'Single parcel' })));

    renderApp('/model-parcels/grid');

    const notice = await screen.findByText(/29 household sizes have no model parcel yet\./);
    expect(notice.closest('p')).not.toHaveAttribute('role', 'alert');
  });

  it('shows the server’s 422 message verbatim when a save is refused', async () => {
    server.use(
      http.get(PARCEL_GRID, () => gridResponse(COMPLETE_GRID)),
      http.put(PARCEL_GRID, () =>
        HttpResponse.json(
          {
            error: {
              code: 'UNPROCESSABLE',
              message: 'That grid does not match the model parcels',
              requestId: 'r1',
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderApp('/model-parcels/grid');
    const user = userEvent.setup();

    await screen.findByRole('combobox', { name: 'Model parcel for 1 adult, 0 children' });
    await user.click(screen.getByRole('button', { name: 'Save the grid' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That grid does not match the model parcels',
    );
  });

  it('previews a household that fits the grid without any clamping note', async () => {
    server.use(
      http.get(PARCEL_GRID, () => gridResponse(COMPLETE_GRID)),
      http.post(PREVIEW, () =>
        HttpResponse.json({
          household: { adults: 2, children: 1, size: 3 },
          modelParcelName: 'Family parcel',
          lines: [{ stockItemId: BEANS.id, quantity: 4 }],
        }),
      ),
    );

    renderApp('/model-parcels/grid');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Preview a household' });
    const adults = screen.getByLabelText('Adults');
    await user.clear(adults);
    await user.type(adults, '2');
    const children = screen.getByLabelText('Children');
    await user.clear(children);
    await user.type(children, '1');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    // Scoped to the result region: every one of the thirty grid cells also
    // offers "Family parcel" as an `<option>`, so an unscoped query is
    // ambiguous.
    const result = within(await screen.findByRole('status'));
    expect(result.getByText(/Family parcel/)).toBeInTheDocument();
    expect(result.getByText(/Baked beans × 4/)).toBeInTheDocument();
    expect(result.queryByText(/clamp/i)).toBeNull();
  });

  it('reads a clamped household as normal information, not as an error', async () => {
    // Verified against a running server: the preview response echoes the
    // household exactly as sent, unclamped, even though the parcel chosen
    // reflects the clamped lookup — so the clamping note comes from the input,
    // not from anything claimed in this response.
    server.use(
      http.get(PARCEL_GRID, () => gridResponse(COMPLETE_GRID)),
      http.post(PREVIEW, () =>
        HttpResponse.json({
          household: { adults: 9, children: 8, size: 17 },
          modelParcelName: 'Family parcel',
          lines: [{ stockItemId: BEANS.id, quantity: 4 }],
        }),
      ),
    );

    renderApp('/model-parcels/grid');
    const user = userEvent.setup();

    const adults = await screen.findByLabelText('Adults');
    await user.clear(adults);
    await user.type(adults, '9');
    const children = screen.getByLabelText('Children');
    await user.clear(children);
    await user.type(children, '8');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const note = await screen.findByText(/is treated as 5 adults, 5 children/);
    // Informational: inside the status region, not an alert.
    expect(note.closest('[role="alert"]')).toBeNull();
    expect(within(screen.getByRole('status')).getByText(/Family parcel/)).toBeInTheDocument();
  });
});
