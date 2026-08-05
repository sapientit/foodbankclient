import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const LEVELS = '/api/v1/stock/levels';
const ADJUSTMENTS = '/api/v1/stock/adjustments';

const BEANS: StockLevel = {
  id: 's2',
  name: 'Baked beans',
  shelfNumber: 'A2',
  isActive: true,
  quantityOnHand: 12,
};

function session() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () => session()),
    http.get(LEVELS, () => HttpResponse.json({ items: [BEANS] })),
  );
});

describe('adjusting stock by hand', () => {
  it('sends a signed, non-zero delta with a reason', async () => {
    let posted: unknown = null;
    server.use(
      http.post(ADJUSTMENTS, async ({ request }) => {
        posted = await request.json();
        // 204: the endpoint answers with no body at all, which is why the
        // mutation uses unwrapVoid.
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/stock/adjust/s2');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: /Thrown away/ }));
    await user.type(screen.getByLabelText('How many'), '-6');
    await user.type(screen.getByLabelText('Why'), 'Six tins out of date');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(posted).toEqual({
      stockItemId: 's2',
      quantityDelta: -6,
      movementType: 'wastage',
      reason: 'Six tins out of date',
    });
  });

  it('does not offer expiry as a movement type', async () => {
    renderApp('/stock/adjust/s2');

    await screen.findByRole('radio', { name: /Thrown away/ });

    expect(screen.queryByRole('radio', { name: /[Ee]xpir/ })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
  });

  it('refuses a zero delta before the request is made', async () => {
    const adjusted = vi.fn();
    server.use(
      http.post(ADJUSTMENTS, () => {
        adjusted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/stock/adjust/s2');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('How many'), '0');
    await user.type(screen.getByLabelText('Why'), 'Nothing changed');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByText(/Zero would change nothing/)).toBeInTheDocument();
    expect(adjusted).not.toHaveBeenCalled();
  });

  it('will not record an adjustment without a reason', async () => {
    const adjusted = vi.fn();
    server.use(
      http.post(ADJUSTMENTS, () => {
        adjusted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/stock/adjust/s2');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('How many'), '6');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByText(/Say why/)).toBeInTheDocument();
    expect(adjusted).not.toHaveBeenCalled();
  });

  it('says what the level would become, including below zero', async () => {
    renderApp('/stock/adjust/s2');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('How many'), '-20');

    expect(
      await screen.findByText('-20 would take Baked beans from 12 to -8.'),
    ).toBeInTheDocument();
  });

  it('shows the server’s message rather than swallowing it', async () => {
    server.use(
      http.post(ADJUSTMENTS, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Stock item not found', requestId: 'r1' } },
          { status: 404 },
        ),
      ),
    );
    renderApp('/stock/adjust/s2');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('How many'), '6');
    await user.type(screen.getByLabelText('Why'), 'Found a box in the van');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That no longer exists');
  });
});
