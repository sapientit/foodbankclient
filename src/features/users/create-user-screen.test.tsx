import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { User } from './queries';

/** Signed in as Pete, an administrator. See `test/render-app.tsx`. */
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

const SAM: User = {
  id: 'u4',
  email: 'sam@x.com',
  displayName: 'Sam Gone',
  role: 'team_lead',
  isActive: false,
  lastLoginAt: null,
  createdAt: '2026-01-06T10:00:00.000Z',
};

function session() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: PETE.id, email: PETE.email, displayName: PETE.displayName, role: PETE.role },
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () => session()),
    http.get(USERS, () => HttpResponse.json({ users: [PETE, SAM] })),
  );
});

async function fillIn({ email, name }: { email: string; name: string }) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Name'), name);
  return user;
}

describe('adding a user', () => {
  it('creates the account and comes back to the list showing it', async () => {
    let posted: unknown = null;
    const created: User = {
      id: 'u9',
      email: 'lead@x.com',
      displayName: 'Ada Lead',
      role: 'team_lead',
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-07-30T09:00:00.000Z',
    };
    let table: User[] = [PETE, SAM];
    server.use(
      // Stateful, because the splice is followed by an invalidate: a fixture
      // that forgot the new row would quietly undo it and prove nothing.
      http.get(USERS, () => HttpResponse.json({ users: table })),
      http.post(USERS, async ({ request }) => {
        posted = await request.json();
        table = [...table, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderApp('/users/new');
    const user = await fillIn({ email: 'lead@x.com', name: 'Ada Lead' });

    await user.selectOptions(screen.getByLabelText('Role'), 'team_lead');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    expect(posted).toEqual({
      email: 'lead@x.com',
      displayName: 'Ada Lead',
      role: 'team_lead',
    });
    // Spliced into the one cached list, so the new row is there before the
    // refetch lands.
    expect(await screen.findByRole('rowheader', { name: /Ada Lead/ })).toBeInTheDocument();
  });

  it('offers to reactivate a retired account instead of adding a duplicate', async () => {
    /*
     * The dead end the server's 409 leaves an admin in: "already exists", for an
     * account they cannot see and cannot delete. There is no delete and email is
     * not amendable, so a cached match is a guaranteed conflict — which is what
     * makes saying so before the request both safe and worth doing.
     */
    const posts = vi.fn();
    server.use(
      http.post(USERS, () => {
        posts();
        return HttpResponse.json(SAM, { status: 201 });
      }),
    );
    renderApp('/users/new');
    const user = await fillIn({ email: 'SAM@x.com', name: 'Sam Gone' });

    expect(screen.getByText(/their account is retired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'show retired accounts' })).toBeInTheDocument();

    const add = screen.getByRole('button', { name: 'Add user' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    await user.click(add);

    expect(posts).not.toHaveBeenCalled();
  });

  it('links to the existing account when the address is already in use', async () => {
    renderApp('/users/new');

    await fillIn({ email: 'pete@x.com', name: 'Pete Again' });

    expect(screen.getByText(/already signs in with that address/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Amend their account' })).toHaveAttribute(
      'href',
      `/users/${PETE.id}`,
    );
  });

  it('names the field the server rejected, and keeps what was typed', async () => {
    server.use(
      http.post(USERS, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Invalid request',
              details: { issues: [{ path: 'displayName', message: 'Too long' }] },
              requestId: 'r1',
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderApp('/users/new');
    const user = await fillIn({ email: 'lead@x.com', name: 'Ada Lead' });

    await user.click(screen.getByRole('button', { name: 'Add user' }));

    // The server names the field and the rule and never echoes the value, so the
    // form is never reset — their own text is the only copy of it.
    expect(await screen.findByText('Too long')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ada Lead');
  });

  it('shows a conflict from the server verbatim', async () => {
    // A duplicate the cached list could not have known about: created by another
    // admin a second ago.
    server.use(
      http.post(USERS, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'A user with that email address already exists',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp('/users/new');
    const user = await fillIn({ email: 'new@x.com', name: 'New Person' });

    await user.click(screen.getByRole('button', { name: 'Add user' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A user with that email address already exists',
    );
  });
});
