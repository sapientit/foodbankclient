import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel, StockTake } from './queries';

/**
 * The stock take, and the two server facts that shape every one of these tests:
 *
 * - **`abandoned` is unreachable and several takes can be open at once.** A
 *   mis-clicked take is permanent, so starting one is confirmed and an existing
 *   open one is resumed rather than duplicated.
 * - **There is no `GET /stock/takes/{id}`**, so nothing can read a recorded
 *   count back. That is why the screen is one page and one Save.
 */

const REFRESH = '/api/v1/auth/refresh';
const TAKES = '/api/v1/stock/takes';
const LEVELS = '/api/v1/stock/levels';

const BEANS: StockLevel = {
  id: 's1',
  name: 'Baked beans',
  shelfNumber: 'A2',
  isActive: true,
  quantityOnHand: 12,
};
const RICE: StockLevel = {
  id: 's2',
  name: 'Rice',
  shelfNumber: 'A10',
  isActive: true,
  quantityOnHand: 4,
};

function openTake(id: string, countedAt = '2026-07-30T09:00:00Z'): StockTake {
  return { id, countedAt, status: 'open', note: null, committedAt: null };
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

describe('opening a stock take', () => {
  it('resumes an open stock take rather than starting a second one', async () => {
    // Several takes can be open at once and none of them can ever be discarded,
    // so a screen that starts a fresh one on entry leaves permanent litter.
    let opened = 0;
    server.use(
      http.get(TAKES, () => HttpResponse.json({ stockTakes: [openTake('t1')] })),
      http.post(TAKES, () => {
        opened += 1;
        return HttpResponse.json({ id: 't2', status: 'open' }, { status: 201 });
      }),
    );

    renderApp('/stock/take');

    expect(await screen.findByText(/Counting the stock take started/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a stock take' })).toBeNull();
    expect(opened).toBe(0);
  });

  it('confirms before starting one, because it cannot be cancelled', async () => {
    let opened = 0;
    server.use(
      http.get(TAKES, () => HttpResponse.json({ stockTakes: [] })),
      http.post(TAKES, () => {
        opened += 1;
        return HttpResponse.json({ id: 't1', status: 'open' }, { status: 201 });
      }),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start a stock take' }));

    expect(screen.getByText('A stock take cannot be cancelled.')).toBeInTheDocument();
    expect(opened).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opened).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Start a stock take' }));
    await user.click(screen.getByRole('button', { name: 'Start the stock take' }));

    expect(opened).toBe(1);
  });

  it('sends an object rather than an empty body when opening one', async () => {
    /*
     * Every field on the body is optional, but the handler parses the body
     * rather than defaulting it — so sending nothing at all is a `400`. It
     * looks like a request that needs no body and it is not.
     */
    let raw: string | null = null;
    server.use(
      http.get(TAKES, () => HttpResponse.json({ stockTakes: [] })),
      http.post(TAKES, async ({ request }) => {
        raw = await request.text();
        return HttpResponse.json({ id: 't1', status: 'open' }, { status: 201 });
      }),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start a stock take' }));
    await user.click(screen.getByRole('button', { name: 'Start the stock take' }));

    await screen.findByLabelText('Counted Baked beans');
    expect(raw).toBe('{}');
  });

  it('never offers to start a second one while the list catches up with the first', async () => {
    /*
     * The handler above answers `GET /stock/takes` with an empty list even
     * after the take has been opened, which is what a slow or stale refetch
     * looks like. Falling back to "no stock take is open" there would invite an
     * operator to start another — and there is no route that discards one.
     */
    server.use(
      http.get(TAKES, () => HttpResponse.json({ stockTakes: [] })),
      http.post(TAKES, () => HttpResponse.json({ id: 't1', status: 'open' }, { status: 201 })),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start a stock take' }));
    await user.click(screen.getByRole('button', { name: 'Start the stock take' }));

    expect(
      await screen.findByText('Counting the stock take you have just started.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a stock take' })).toBeNull();
  });

  it('makes the operator choose when several are open, and says the extras cannot be removed', async () => {
    server.use(
      http.get(TAKES, () =>
        HttpResponse.json({
          stockTakes: [
            openTake('t1', '2026-07-29T09:00:00Z'),
            openTake('t2', '2026-07-30T09:00:00Z'),
          ],
        }),
      ),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('There is more than one stock take open');
    expect(warning).toHaveTextContent('The others cannot be removed');

    const choices = screen.getAllByRole('button', { name: /^Count the stock take started/ });
    expect(choices).toHaveLength(2);

    const [first] = choices;
    if (first === undefined) throw new Error('expected a choice');
    await user.click(first);

    expect(await screen.findByText(/^Counting the stock take started/)).toHaveTextContent(
      'One other stock take is open and cannot be removed.',
    );
  });
});

describe('counting', () => {
  beforeEach(() => {
    server.use(http.get(TAKES, () => HttpResponse.json({ stockTakes: [openTake('t1')] })));
  });

  it('sends only the items that were counted, leaving a blank alone', async () => {
    // A blank is "I have not got to that shelf". Sending it as a zero would
    // write off the stock of every item nobody reached.
    let body: unknown = null;
    server.use(
      http.post(`${TAKES}/t1/counts`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counted Baked beans'), '9');
    await user.click(screen.getByRole('button', { name: 'Save counts' }));

    expect(await screen.findByText('One count saved.')).toBeInTheDocument();
    expect(body).toEqual({ counts: [{ stockItemId: 's1', countedQuantity: 9 }] });
  });

  it('records a zero, because an empty shelf is a count', async () => {
    let body: unknown = null;
    server.use(
      http.post(`${TAKES}/t1/counts`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counted Rice'), '0');
    await user.click(screen.getByRole('button', { name: 'Save counts' }));

    await screen.findByText('One count saved.');
    expect(body).toEqual({ counts: [{ stockItemId: 's2', countedQuantity: 0 }] });
  });

  it('refuses to save nothing at all before any request is made', async () => {
    let attempts = 0;
    server.use(
      http.post(`${TAKES}/t1/counts`, () => {
        attempts += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp('/stock/take');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Save counts' }));

    expect(await screen.findByText('Enter at least one count before saving.')).toBeInTheDocument();
    expect(attempts).toBe(0);
  });

  it('lists the shelves in the order the server sent them, never re-sorted', async () => {
    // A2 before A10 is the server's zero-padded shelf sort, and it is the order
    // the aisle is walked in. Any client-side sort would swap them.
    renderApp('/stock/take');

    await screen.findByLabelText('Counted Baked beans');
    const rows = screen.getAllByRole('row').slice(1);

    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Baked beans',
      'Rice',
    ]);
  });
});

describe('committing', () => {
  beforeEach(() => {
    server.use(
      http.get(TAKES, () => HttpResponse.json({ stockTakes: [openTake('t1')] })),
      http.post(`${TAKES}/t1/counts`, () => new HttpResponse(null, { status: 204 })),
    );
  });

  async function countAndCommit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Counted Baked beans'), '12');
    await user.click(screen.getByRole('button', { name: 'Save counts' }));
    await screen.findByText('One count saved.');
    await user.click(screen.getByRole('button', { name: 'Commit the stock take' }));
    await user.click(screen.getByRole('button', { name: 'Commit and correct the ledger' }));
  }

  it('says everything matched rather than showing an empty table', async () => {
    /*
     * The server returns **only** the items whose count differed, so `[]` is
     * the best possible outcome and has to read like one. An empty table with
     * "no rows" would say the opposite of what happened.
     */
    server.use(
      http.post(`${TAKES}/t1/commit`, () =>
        HttpResponse.json({
          id: 't1',
          status: 'committed',
          committedAt: '2026-07-30T11:00:00Z',
          adjustments: [],
        }),
      ),
    );

    renderApp('/stock/take');
    await countAndCommit(userEvent.setup());

    expect(await screen.findByText('Everything matched')).toBeInTheDocument();
    expect(screen.getByText(/nothing needed correcting and no stock moved/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('names each item that did not match and by how much', async () => {
    server.use(
      http.post(`${TAKES}/t1/commit`, () =>
        HttpResponse.json({
          id: 't1',
          status: 'committed',
          committedAt: '2026-07-30T11:00:00Z',
          adjustments: [{ stockItemId: 's1', expected: 12, counted: 9, delta: -3 }],
        }),
      ),
    );

    renderApp('/stock/take');
    await countAndCommit(userEvent.setup());

    const row = await screen.findByRole('row', { name: /Baked beans/ });
    expect(row).toHaveTextContent('12');
    expect(row).toHaveTextContent('9');
    expect(row).toHaveTextContent('-3');
  });

  it('shows the server’s refusal when there is nothing to commit', async () => {
    // `409` here means already committed, or no counts recorded. Both are
    // sentences worth showing rather than flattening into "went wrong".
    server.use(
      http.post(`${TAKES}/t1/commit`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'This stock take has no counts recorded',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/stock/take');
    await countAndCommit(userEvent.setup());

    expect(await screen.findByText('This stock take has no counts recorded')).toBeInTheDocument();
  });
});
