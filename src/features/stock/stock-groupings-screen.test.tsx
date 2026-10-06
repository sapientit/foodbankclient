import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@example.test', displayName: 'Pete', role: 'admin' },
      }),
    ),
    http.get('/api/v1/stock/groupings', () =>
      HttpResponse.json({ items: [{ id: 'g1', name: 'Non-perishable' }] }),
    ),
  );
});

describe('Stock-take groupings', () => {
  it('keeps the new grouping entry aligned within the same card as the saved groups', async () => {
    renderApp('/stock/groupings');

    const card = await screen.findByRole('region', { name: 'Stock-take groupings' });
    const existingName = within(card).getByLabelText('Name for Non-perishable');
    const newName = within(card).getByLabelText('New grouping name');

    expect(within(card).getByRole('table')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Add grouping' })).toBeInTheDocument();
    expect(existingName.className).toBe(newName.className);
  });
});
