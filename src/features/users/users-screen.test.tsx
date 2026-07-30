import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { User } from './queries';

/**
 * The users list, as an admin meets it. Signed in as Pete, who is one of two
 * administrators.
 *
 * Fixtures are typed as the generated `User`, so a shape that no longer matches
 * the server's contract fails to compile rather than passing quietly.
 */
const REFRESH = '/api/v1/auth/refresh';
const USERS = '/api/v1/users';

const PETE: User = {
  id: 'u1',
  email: 'pete@x.com',
  displayName: 'Pete Bennett',
  role: 'admin',
  isActive: true,
  lastLoginAt: '2026-07-29T09:30:00.000Z',
  createdAt: '2026-01-05T10:00:00.000Z',
};

const BEV: User = {
  id: 'u2',
  email: 'bev@x.com',
  displayName: 'Bev Admin',
  role: 'admin',
  isActive: true,
  lastLoginAt: '2026-07-28T08:00:00.000Z',
  createdAt: '2026-01-05T10:00:00.000Z',
};

const ADA: User = {
  id: 'u3',
  email: 'lead@x.com',
  displayName: 'Ada Lead',
  role: 'team_lead',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-06-01T10:00:00.000Z',
};

const SAM: User = {
  id: 'u4',
  email: 'sam@x.com',
  displayName: 'Sam Gone',
  role: 'team_lead',
  isActive: false,
  lastLoginAt: '2026-02-01T10:00:00.000Z',
  createdAt: '2026-01-06T10:00:00.000Z',
};

function session() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: PETE.id, email: PETE.email, displayName: PETE.displayName, role: PETE.role },
  });
}

function conflict(message: string) {
  return HttpResponse.json(
    { error: { code: 'CONFLICT', message, requestId: 'r1' } },
    { status: 409 },
  );
}

function list(...users: User[]) {
  return HttpResponse.json({ users });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () => session()),
    http.get(USERS, () => list(PETE, BEV, ADA, SAM)),
  );
});

/** The confirmation's own button — every row carries one with the same label. */
function confirmButton() {
  return within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' });
}

/** Waits for the row, so a test never queries one before the session has restored. */
async function row(name: string) {
  return within(await screen.findByRole('row', { name: new RegExp(name) }));
}

describe('the users list', () => {
  it('says “Never signed in” rather than leaving the cell blank', async () => {
    renderApp('/users');

    // An account nobody has ever signed in with is usually one created with a
    // typo in the address. A blank cell hides that; these words are how it is
    // spotted, and they say "never signed in", not "not here today".
    expect((await row('Ada Lead')).getByText('Never signed in')).toBeInTheDocument();
    expect((await row('Pete Bennett')).getByText('29 Jul 2026, 10:30')).toBeInTheDocument();
  });

  it('marks which row is you', async () => {
    renderApp('/users');

    const mine = await screen.findByRole('rowheader', { name: /Pete Bennett/ });

    expect(mine).toHaveTextContent('Pete Bennett (you)');
  });

  it('hides retired accounts behind a count that says how many', async () => {
    renderApp('/users');

    const toggle = await screen.findByRole('checkbox', { name: 'Show retired accounts (1)' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText('Sam Gone')).toBeNull();

    await userEvent.setup().click(toggle);

    // In words, not colour alone, and no strikethrough: the person stays named
    // on the stock, attendance and audit records they are part of.
    expect((await row('Sam Gone')).getByText('Retired')).toBeInTheDocument();
    expect((await row('Sam Gone')).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('never offers to deactivate your own account, and sends no PATCH', async () => {
    const patches = vi.fn();
    server.use(
      http.patch(`${USERS}/:id`, () => {
        patches();
        return list();
      }),
    );
    renderApp('/users');

    const deactivate = (await row('Pete Bennett')).getByRole('button', { name: 'Deactivate' });

    // Refused with a reason on a real focusable button, not a removed control:
    // somebody looking for Deactivate has to find it and be told why not.
    expect(deactivate).toHaveAttribute('aria-disabled', 'true');
    expect(deactivate).not.toBeDisabled();
    await userEvent.setup().click(deactivate);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(patches).not.toHaveBeenCalled();
    expect(
      (await row('Pete Bennett')).getByText(/Another administrator has to do it/),
    ).toBeInTheDocument();
  });

  it('tells the truth about the fifteen-minute delay before deactivating anyone', async () => {
    renderApp('/users');
    const user = userEvent.setup();

    await user.click((await row('Ada Lead')).getByRole('button', { name: 'Deactivate' }));

    // "May take a few minutes" would be a lie an admin could act on — they would
    // close the laptop believing somebody was locked out.
    const dialog = within(screen.getByRole('dialog', { name: 'Deactivate Ada Lead?' }));
    expect(dialog.getByText(/keep working for up to fifteen minutes/)).toBeInTheDocument();
    expect(dialog.getByText(/no way to end that session sooner/)).toBeInTheDocument();
    expect(dialog.getByText(/Nothing is deleted/)).toBeInTheDocument();
  });

  it('allows deactivating a team lead even when they are the only one', async () => {
    // The server has no such guard. Inventing one would refuse work the food
    // bank is allowed to do.
    let patched: unknown = null;
    let ada = ADA;
    server.use(
      // Stateful on purpose: the splice puts the new row on screen at once and
      // the invalidate refetches straight after, so a fixture that forgot the
      // change would quietly undo it.
      http.get(USERS, () => list(PETE, ada)),
      http.patch(`${USERS}/:id`, async ({ request }) => {
        patched = await request.json();
        ada = { ...ADA, isActive: false };
        return HttpResponse.json(ada);
      }),
    );
    renderApp('/users');
    const user = userEvent.setup();

    await user.click((await row('Ada Lead')).getByRole('button', { name: 'Deactivate' }));
    await user.click(confirmButton());

    expect(patched).toEqual({ isActive: false });
    // Spliced, so the row is right before the refetch lands — and Ada is now
    // behind the retired toggle.
    expect(
      await screen.findByRole('checkbox', { name: 'Show retired accounts (1)' }),
    ).toBeInTheDocument();
  });

  it('shows the server’s message when the last active admin cannot be deactivated', async () => {
    /*
     * Unpredictable by construction: this list shows two active admins, so
     * nothing here could have known. Another admin retired Bev a second ago.
     */
    const lists = vi.fn();
    server.use(
      http.get(USERS, () => {
        lists();
        return list(PETE, BEV, ADA);
      }),
      http.patch(`${USERS}/:id`, () =>
        conflict('The last active admin cannot be demoted or deactivated'),
      ),
    );
    renderApp('/users');
    const user = userEvent.setup();

    await user.click((await row('Bev Admin')).getByRole('button', { name: 'Deactivate' }));
    await user.click(confirmButton());

    // Verbatim, and nothing added: a manufactured next step here would be a
    // guess about a rule the client got wrong.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The last active admin cannot be demoted or deactivated',
    );
    expect(lists.mock.calls.length).toBeGreaterThan(1);
  });

  it('refetches after a lockout conflict it did not predict', async () => {
    const lists = vi.fn();
    server.use(
      http.get(USERS, () => {
        lists();
        return list(PETE, BEV, ADA);
      }),
      http.patch(`${USERS}/:id`, () =>
        conflict('The last active admin cannot be demoted or deactivated'),
      ),
    );
    renderApp('/users');
    const user = userEvent.setup();
    await user.click((await row('Bev Admin')).getByRole('button', { name: 'Deactivate' }));
    const before = lists.mock.calls.length;

    await user.click(confirmButton());
    await screen.findByRole('alert');

    // A refusal nobody saw coming is proof this copy of who can administer the
    // food bank is out of date. Refetching is the only useful answer to it.
    expect(lists.mock.calls.length).toBeGreaterThan(before);
  });

  it('reactivates a retired account without asking a question first', async () => {
    // Nothing is at stake: reactivating cannot lock anyone out, and the person
    // was never deleted.
    let patched: unknown = null;
    server.use(
      http.patch(`${USERS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...SAM, isActive: true });
      }),
    );
    renderApp('/users?retired=1');
    const user = userEvent.setup();

    await user.click((await row('Sam Gone')).getByRole('button', { name: 'Reactivate' }));

    expect(patched).toEqual({ isActive: true });
  });
});
