import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { StockLevel } from '../stock/queries';
import type { TargetStockList } from './queries';

/** Signed in as Ada, a team lead — its own file, one actor per module. */
const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';
const STOCK_LEVELS = '/api/v1/stock/levels';

const LEVELS: StockLevel[] = [
  {
    id: 's1',
    name: 'Baked beans 400g',
    category: 'Tinned',
    description: null,
    shelfNumber: 'A1',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
    quantityOnHand: 10,
  },
];

const LIST: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [
    { kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { kind: 'item', stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
  ],
};

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
    http.get(LISTS, () => HttpResponse.json({ targetStockLists: [LIST] })),
    http.get(STOCK_LEVELS, () => HttpResponse.json({ items: LEVELS })),
  );
});

describe('a team lead on the shopping screen', () => {
  it('generates the buy list and is never blocked by a discrepancy', async () => {
    renderApp('/stock/shopping?list=t1');

    expect(await screen.findByLabelText('Quantity for Baked beans 400g')).toHaveValue('38');
    expect(screen.getByText(/1 item needs an administrator.s attention/)).toBeInTheDocument();

    // Nothing on this screen is disabled for a team lead.
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
  });

  it('has the Shopping sub-tab but not target-list maintenance', async () => {
    renderApp('/stock/shopping');

    await screen.findByLabelText('Choose a target stock list');
    const nav = screen.getByRole('navigation', { name: 'Section navigation' });
    expect(within(nav).getByRole('link', { name: 'Shopping' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Target lists' })).toBeNull();
  });

  it('does not offer the administrator-only session-requirements calculation', async () => {
    renderApp('/stock/shopping?list=t1&calculation=requirements');

    await screen.findByLabelText('Choose a target stock list');
    expect(screen.queryByRole('radio', { name: /Cover session requirements/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Bring stock up to target' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Calculate requirements' })).toBeNull();
    expect(
      screen.getByText('Session-requirements planning is available to administrators.'),
    ).toBeInTheDocument();
  });
});
