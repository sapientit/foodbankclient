import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type {
  buildPickListInformation,
  pickListInformationNeedsOptionSources,
} from '../pick-lists/pick-list-information';
import type {
  resolvePreferenceLines,
  validatePreferenceRules,
} from '../pick-lists/preference-rules';
import type { StockItem, StockLevel } from '../stock/queries';
import type { TargetStockList } from './queries';

interface PreferenceRulesModule {
  readonly resolvePreferenceLines: typeof resolvePreferenceLines;
  readonly validatePreferenceRules: typeof validatePreferenceRules;
}
interface PickListInformationModule {
  readonly buildPickListInformation: typeof buildPickListInformation;
  readonly pickListInformationNeedsOptionSources: typeof pickListInformationNeedsOptionSources;
}

vi.mock('../pick-lists/preference-rules', async (importOriginal) => {
  const actual = await importOriginal<PreferenceRulesModule>();
  return {
    ...actual,
    resolvePreferenceLines: () => [],
    validatePreferenceRules: () => ({ errors: [] }),
  };
});

vi.mock('../pick-lists/pick-list-information', async (importOriginal) => {
  const actual = await importOriginal<PickListInformationModule>();
  return {
    ...actual,
    buildPickListInformation: () => [],
    pickListInformationNeedsOptionSources: () => false,
  };
});

const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';
const STOCK_LEVELS = '/api/v1/stock/levels';
const STOCK_ITEMS = '/api/v1/stock/items';
const CRATES = '/api/v1/stock/crates';
const SESSIONS = '/api/v1/sessions';
const REFERRALS = '/api/v1/referrals';
const PREPARE_PICK_LIST = '/api/v1/sessions/:sessionId/pick-list';
const REQUIREMENT_SUMMARY = '/api/v1/pick-lists/stock-requirement-summary';

const level = (
  over: Partial<StockLevel> &
    Pick<StockItem, 'id' | 'name' | 'category'> & { quantityOnHand: number },
): StockLevel => ({
  description: null,
  shelfNumber: 'A1',
  lowStockThreshold: null,
  groupingId: null,
  unitsPerPack: null,
  packUnitLabel: null,
  isActive: true,
  ...over,
});

const LEVELS: StockLevel[] = [
  level({ id: 's1', name: 'Baked beans 400g', category: 'Tinned', quantityOnHand: 40 }),
  level({ id: 's2', name: 'Long-life milk 1L', category: 'Dairy', quantityOnHand: 10 }),
  level({
    id: 's3',
    name: 'Value rice 500g',
    category: 'Dry goods',
    quantityOnHand: 0,
    isActive: false,
  }),
  level({ id: 's4', name: 'Sugar 1kg', category: 'Baking', quantityOnHand: 15 }),
];

const LIST: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [
    { kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { kind: 'item', stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 },
    { kind: 'item', stockItemId: 's3', name: 'Value rice 500g', targetQuantity: 20 },
    { kind: 'item', stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
    { kind: 'item', stockItemId: 's4', name: 'Sugar 1kg', targetQuantity: 10 },
  ],
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
    http.get(LISTS, () => HttpResponse.json({ targetStockLists: [LIST] })),
    http.get(STOCK_LEVELS, () => HttpResponse.json({ items: LEVELS })),
  );
});

describe('the shopping screen', () => {
  it('prepares this week’s open pick lists before calculating selected-list requirements', async () => {
    let prepared = false;
    let summaryRequested = false;
    server.use(
      http.get(LISTS, () =>
        HttpResponse.json({
          targetStockLists: [
            {
              id: 't1',
              name: 'Standard week',
              lines: [
                { kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
                { kind: 'crate', crateId: 'c1', crateName: 'Tinned supplies', targetQuantity: 1 },
              ],
            },
          ],
        }),
      ),
      http.get(CRATES, () =>
        HttpResponse.json({
          items: [
            {
              id: 'c1',
              name: 'Tinned supplies',
              sizePerCrate: 1,
              members: [{ stockItemId: 's4', shoppingCompositionPercent: 100 }],
            },
          ],
        }),
      ),
      http.get(STOCK_ITEMS, () =>
        HttpResponse.json({
          items: [
            { id: 's1', name: 'Baked beans 400g', category: 'Tinned', isActive: true },
            { id: 's2', name: 'Long-life milk 1L', category: 'Dairy', isActive: true },
          ],
        }),
      ),
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            { id: 'session-this-week', status: 'planned' },
            { id: 'session-confirmed', status: 'confirmed' },
            { id: 'session-cancelled', status: 'cancelled' },
          ],
        }),
      ),
      http.get(REFERRALS, () =>
        HttpResponse.json({ referrals: [{ id: 'r1', adults: 1, children: 0, answers: {} }] }),
      ),
      http.post(PREPARE_PICK_LIST, ({ params }) => {
        expect(params.sessionId).toBe('session-this-week');
        prepared = true;
        return HttpResponse.json({ sessionId: 'session-this-week', created: true });
      }),
      http.get(REQUIREMENT_SUMMARY, ({ request }) => {
        expect(prepared).toBe(true);
        expect(new URL(request.url).searchParams.get('order')).toBe('category');
        summaryRequested = true;
        return HttpResponse.json({
          items: [
            { id: 's1', name: 'Baked beans 400g', category: 'Tinned', requiredQuantity: 60 },
            { id: 's2', name: 'Long-life milk 1L', category: 'Dairy', requiredQuantity: 8 },
            { id: 's4', name: 'Sugar 1kg', category: 'Baking', requiredQuantity: 100 },
            {
              id: 'not-on-list',
              name: 'Tinned peaches',
              category: 'Tinned',
              requiredQuantity: 100,
            },
          ],
        });
      }),
    );

    const user = userEvent.setup();
    renderApp('/stock/shopping?list=t1');

    await user.click(
      await screen.findByRole('radio', { name: /Cover session requirements through Saturday/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Calculate requirements' }));

    expect(await screen.findByLabelText('Quantity for Baked beans 400g')).toHaveValue('20');
    expect(screen.queryByLabelText('Quantity for Long-life milk 1L')).toBeNull();
    expect(screen.getByLabelText('Quantity for Sugar 1kg')).toHaveValue('85');
    expect(screen.queryByLabelText('Quantity for Tinned peaches')).toBeNull();
    expect(prepared).toBe(true);
    expect(summaryRequested).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Bring stock up to target' }));
    expect(await screen.findByLabelText('Quantity for Baked beans 400g')).toHaveValue('8');

    await user.click(
      screen.getByRole('radio', { name: /Cover session requirements through Saturday/ }),
    );
    expect(screen.getByRole('button', { name: 'Calculate requirements' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open print dialog' })).toBeNull();
  });

  it('shows only shortfalls in three columns, with editable quantities labelled for assistive technology only', async () => {
    renderApp('/stock/shopping');
    const user = userEvent.setup();

    await user.selectOptions(
      await screen.findByLabelText('Choose a target stock list'),
      'Standard week',
    );

    const headings = await screen.findAllByRole('heading', { level: 3 });
    const categoryHeadings = headings
      .map((h) => h.textContent)
      .filter((t) => t === 'Dairy' || t === 'Tinned');
    expect(categoryHeadings).toEqual(['Dairy', 'Tinned']);

    const milkQuantity = screen.getByLabelText('Quantity for Long-life milk 1L');
    expect(milkQuantity).toHaveValue('50');
    expect(screen.getByLabelText('Quantity for Baked beans 400g')).toHaveValue('8');
    expect(screen.getByText('Quantity for Long-life milk 1L').className).toMatch(/visuallyHidden/);

    const printedMilkQuantity = screen.getByText('50');
    expect(printedMilkQuantity.className).toMatch(/printQuantity/);
    expect(printedMilkQuantity.tagName).toBe('SPAN');

    const columns = screen.getByRole('heading', { name: 'Dairy', level: 3 }).parentElement
      ?.parentElement?.parentElement;
    expect(columns?.children).toHaveLength(3);
    // Sugar is already above its target — not on the list.
    expect(screen.queryByRole('row', { name: /Sugar 1kg/ })).toBeNull();
  });

  it('flags a renamed item inline and lists retired and missing items as attention only', async () => {
    renderApp('/stock/shopping?list=t1');

    expect(await screen.findByText(/was .UHT milk 1L./)).toBeInTheDocument();

    const attention = screen.getByRole('region', {
      name: /Needs an administrator.s attention/,
    });
    expect(within(attention).getByRole('row', { name: /Value rice 500g/ })).toHaveTextContent('20');
    expect(within(attention).getByRole('row', { name: /Instant coffee 200g/ })).toHaveTextContent(
      '6',
    );

    expect(screen.getByText(/3 items need an administrator.s attention/)).toBeInTheDocument();
  });

  it('copies the list as tab-separated text and opens the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/stock/shopping?list=t1');

    await user.click(await screen.findByRole('button', { name: 'Copy to clipboard' }));

    const text = await navigator.clipboard.readText();
    expect(text).toContain('Dairy\nLong-life milk 1L\t50');
    expect(text).toContain('Tinned\nBaked beans 400g\t8');
    expect(text).toContain("Needs an administrator's attention — not bought\nValue rice 500g\t20");

    await user.clear(screen.getByLabelText('Quantity for Long-life milk 1L'));
    await user.type(screen.getByLabelText('Quantity for Long-life milk 1L'), '47');
    await user.click(screen.getByRole('button', { name: 'Copied' }));
    expect(await navigator.clipboard.readText()).toContain('Dairy\nLong-life milk 1L\t47');

    await user.click(screen.getByRole('button', { name: 'Open print dialog' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('counts a renamed-only list as needing attention while still buying the item', async () => {
    server.use(
      http.get(LISTS, () =>
        HttpResponse.json({
          targetStockLists: [
            {
              id: 't2',
              name: 'Renamed only',
              lines: [{ kind: 'item', stockItemId: 's2', name: 'UHT milk 1L', targetQuantity: 60 }],
            },
          ],
        }),
      ),
    );

    renderApp('/stock/shopping?list=t2');

    // Bought — in its category group with the quantity.
    expect(await screen.findByLabelText('Quantity for Long-life milk 1L')).toHaveValue('50');
    // And still counted for the administrator.
    expect(screen.getByText(/1 item needs an administrator.s attention/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Needs an administrator.s attention/ })).toBeNull();
  });

  it('says nothing is to be bought when the shortfalls are all retired or missing', async () => {
    server.use(
      http.get(LISTS, () =>
        HttpResponse.json({
          targetStockLists: [
            {
              id: 't3',
              name: 'All gone',
              lines: [
                { kind: 'item', stockItemId: 's3', name: 'Value rice 500g', targetQuantity: 20 },
                {
                  kind: 'item',
                  stockItemId: 'gone',
                  name: 'Instant coffee 200g',
                  targetQuantity: 6,
                },
              ],
            },
          ],
        }),
      ),
    );

    renderApp('/stock/shopping?list=t3');

    expect(await screen.findByText(/Nothing to buy from this list/)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /Needs an administrator.s attention/ }),
    ).toBeInTheDocument();
  });
});
