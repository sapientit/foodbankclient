import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockItem } from './queries';

/**
 * The shop, and the reason it gets its own file's worth of attention: **there is
 * no idempotency key on `POST /stock/purchases`.** A second request is a second
 * shop on the ledger — money spent once, stock recorded twice, discovered days
 * later if at all.
 */

const REFRESH = '/api/v1/auth/refresh';
const SEARCH = '/api/v1/stock/search';
const PURCHASES = '/api/v1/stock/purchases';

const BEANS: StockItem = { id: 's1', name: 'Baked beans', shelfNumber: 'A2', isActive: true };
const RICE: StockItem = { id: 's2', name: 'Rice', shelfNumber: 'A10', isActive: true };

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(SEARCH, () => HttpResponse.json({ items: [BEANS, RICE] })),
  );
});

/** Types a search term and puts the first named result on the list. */
async function addItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  const search = screen.getByLabelText('Find an item');
  await user.clear(search);
  await user.type(search, name.slice(0, 3));

  await user.click(await screen.findByRole('button', { name: new RegExp(`^Add ${name}`) }));

  /*
   * Wait for the line to be in the list before returning: clicking Add is not
   * the same as the item having landed, and a caller adding two items in a row
   * would otherwise race the second add against the first render.
   *
   * **This narrows the window but does not close it.** `ItemSearch` renders its
   * results only while the query for the *current* debounced term is successful,
   * so the whole list unmounts and remounts as the term settles; a button found
   * immediately before that can be detached by the time the click lands, and a
   * click on a detached node silently does nothing. Roughly one full
   * `npm run check` in five still fails here, now at this line — which is the
   * honest place for it, rather than downstream as a shop posting one line
   * instead of two.
   *
   * Do not "fix" this by only clicking when the line is absent: `adds up a
   * second tap on the same item` adds the same item deliberately, and that guard
   * makes the second tap impossible. Tried on 31 July 2026; it failed six runs
   * out of six. The real fix is to wait for the search results to correspond to
   * the term just typed before clicking at all.
   */
  await screen.findByLabelText(`How many ${name}`);
}

describe('recording a shop', () => {
  it('posts the shop exactly once when Save is double-tapped', async () => {
    /*
     * The double tap is dispatched **synchronously**, both clicks before React
     * can re-render. That is what a real double tap on a phone is, and it is
     * why a `disabled` attribute cannot be the guard: it would not have been
     * applied yet. The Save control carries `aria-disabled` instead, so the
     * second click really does reach the handler — and the synchronous ref lock
     * is the only thing that refuses it.
     *
     * Confirmed to fail with two POSTs when the ref check is removed.
     */
    const posted: unknown[] = [];
    server.use(
      http.post(PURCHASES, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ purchaseId: 'p1', lines: 1 }, { status: 201 });
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');

    const save = screen.getByRole('button', { name: 'Record the shop' });
    act(() => {
      save.click();
      save.click();
    });

    await screen.findByText('Shop recorded');
    expect(posted).toHaveLength(1);
  });

  it('sends one request carrying every line', async () => {
    let body: unknown = null;
    server.use(
      http.post(PURCHASES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ purchaseId: 'p1', lines: 2 }, { status: 201 });
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await addItem(user, 'Rice');

    const quantity = screen.getByLabelText('How many Baked beans');
    await user.clear(quantity);
    await user.type(quantity, '24');
    await user.type(screen.getByLabelText('Note (optional)'), 'Tesco run');

    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    await screen.findByText('Shop recorded');
    expect(body).toEqual({
      lines: [
        { stockItemId: 's1', quantity: 24 },
        { stockItemId: 's2', quantity: 1 },
      ],
      note: 'Tesco run',
    });
  });

  it('does not offer to try again when the request got no answer, and says to go and check', async () => {
    // The shop may already be on the ledger. A Try again button here is the
    // worst control in the application.
    server.use(http.post(PURCHASES, () => HttpResponse.error()));

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('We do not know whether this saved');
    expect(notice).toHaveTextContent('Check the stock levels first');
    expect(
      within(notice).getByRole('link', { name: /Go and check the stock levels/ }),
    ).toHaveAttribute('href', '/stock');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('will not send the shop a second time after an answer that never came', async () => {
    // The lock stays held: an ambiguous failure is the one case where trying
    // again is worse than doing nothing.
    let attempts = 0;
    server.use(
      http.post(PURCHASES, () => {
        attempts += 1;
        return HttpResponse.error();
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));
    await screen.findByText('We do not know whether this saved');

    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    expect(attempts).toBe(1);
  });

  it('says nothing at all was saved when a line names an unknown item', async () => {
    // The write is all-or-nothing, and an operator left guessing whether half a
    // shop went in has no way to find out.
    server.use(http.post(PURCHASES, () => new HttpResponse(null, { status: 404 })));

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Nothing was saved');
    expect(notice).toHaveTextContent('none');
    expect(notice).toHaveTextContent('The whole shop is still to record');
  });

  it('lets the operator send it again after the server refused to write anything', async () => {
    let attempts = 0;
    server.use(
      http.post(PURCHASES, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 404 })
          : HttpResponse.json({ purchaseId: 'p1', lines: 1 }, { status: 201 });
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));
    await screen.findByText('Nothing was saved');

    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    await screen.findByText('Shop recorded');
    expect(attempts).toBe(2);
  });

  it('renders search results in the order the server sent them, never re-sorted', async () => {
    /*
     * `/stock/search` answers **alphabetically**, not in shelf order, and this
     * fixture is deliberately in neither — so a client-side `sort()` of any
     * kind would change the order and fail the assertion.
     */
    const SUGAR: StockItem = { id: 's3', name: 'Sugar', shelfNumber: 'B1', isActive: true };
    server.use(http.get(SEARCH, () => HttpResponse.json({ items: [SUGAR, BEANS, RICE] })));

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Find an item'), 'a');

    await screen.findByRole('button', { name: /^Add Sugar/ });
    const results = screen.getAllByRole('button', { name: /^Add / });

    expect(results.map((button) => button.textContent)).toEqual([
      'Add Sugar (shelf B1)',
      'Add Baked beans (shelf A2)',
      'Add Rice (shelf A10)',
    ]);
  });

  it('does not search until there is something to search for', async () => {
    let searches = 0;
    server.use(
      http.get(SEARCH, () => {
        searches += 1;
        return HttpResponse.json({ items: [BEANS] });
      }),
    );

    renderApp('/stock/shop');
    await screen.findByLabelText('Find an item');

    // The query is idle on an empty term: `q` has a minimum length of 1 and an
    // empty one is a 400, not an empty list.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Record a shop' })).toBeInTheDocument();
    });
    expect(searches).toBe(0);
  });

  it('refuses a shop with nothing on it before any request is made', async () => {
    let attempts = 0;
    server.use(
      http.post(PURCHASES, () => {
        attempts += 1;
        return HttpResponse.json({ purchaseId: 'p1', lines: 0 }, { status: 201 });
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    expect(
      await screen.findByText('Add at least one item before recording the shop.'),
    ).toBeInTheDocument();
    expect(attempts).toBe(0);
  });

  it('adds up a second tap on the same item rather than sending two lines for it', async () => {
    let body: unknown = null;
    server.use(
      http.post(PURCHASES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ purchaseId: 'p1', lines: 1 }, { status: 201 });
      }),
    );

    renderApp('/stock/shop');
    const user = userEvent.setup();

    await screen.findByLabelText('Find an item');
    await addItem(user, 'Baked beans');
    await addItem(user, 'Baked beans');

    await user.click(screen.getByRole('button', { name: 'Record the shop' }));

    await screen.findByText('Shop recorded');
    expect(body).toEqual({ lines: [{ stockItemId: 's1', quantity: 2 }] });
  });
});
