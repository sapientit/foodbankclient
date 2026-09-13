import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { TargetStockList } from './queries';

/**
 * A team lead *can* read target stock lists — that is how the Shopping screen
 * works (`API.md` §2, "Target stock lists: read" is both roles). So a team lead
 * who types the maintenance URL sees the list, not a 403. The refusal comes
 * from a write: **Delete** (and Save on the editor). With no role guard on the
 * route, that request is still made and the server's `403` is rendered as a
 * plain explanation, not a crash.
 */
const REFRESH = '/api/v1/auth/refresh';
const LISTS = '/api/v1/target-stock-lists';

const STANDARD: TargetStockList = {
  id: 't1',
  name: 'Standard week',
  lines: [{ kind: 'item', stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 }],
};

describe('a team lead on the target-stock-list maintenance screen', () => {
  it('reads the list but is refused when they try to delete one', async () => {
    const deleteAttempted = vi.fn();
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
        }),
      ),
      http.get(LISTS, () => HttpResponse.json({ targetStockLists: [STANDARD] })),
      http.delete(`${LISTS}/:id`, () => {
        deleteAttempted();
        return HttpResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'This action requires the admin role',
              requestId: 'r1',
            },
          },
          { status: 403 },
        );
      }),
    );

    renderApp('/stock/target-lists');
    const user = userEvent.setup();

    const row = await screen.findByRole('row', { name: /Standard week/ });
    await user.click(within(row).getByRole('button', { name: 'Delete Standard week' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleteAttempted).toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});
