import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { User } from './queries';

/** Signed in as Pete, one of two administrators. See `test/render-app.tsx`. */
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
    http.get(USERS, () => HttpResponse.json({ users: [PETE, BEV, SAM] })),
  );
});

describe('amending a user', () => {
  it('sends no email field when amending a user', async () => {
    /*
     * The one that has to exist. The server's patch schema is a plain object, so
     * an `email` sent here is **silently stripped**: the request succeeds, the
     * address does not change, and nothing anywhere reports a problem. Only this
     * assertion would notice.
     */
    let patched: unknown = null;
    server.use(
      http.patch(`${USERS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...BEV, displayName: 'Bev Bennett' });
      }),
    );
    renderApp(`/users/${BEV.id}`);
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Bev Bennett');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({ displayName: 'Bev Bennett', role: 'admin' });
    expect(patched).not.toHaveProperty('email');
  });

  it('offers no way to type an email address at all', async () => {
    renderApp(`/users/${BEV.id}`);

    // Not a disabled input: that invites "so who *can* unlock it?", and the
    // answer is nobody. Static text, and what to do instead.
    expect(await screen.findByText('bev@x.com')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /email/i })).toBeNull();
    expect(screen.getByText(/An email address cannot be changed/)).toBeInTheDocument();
    expect(screen.getByText(/retire this account/)).toBeInTheDocument();
  });

  it('does not offer to retire an account from the amend form', async () => {
    // Rename and retire are separate on purpose: it is what makes every 409 from
    // this form have exactly one possible cause.
    renderApp(`/users/${BEV.id}`);

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });

  it('never offers to demote your own account, and sends no PATCH', async () => {
    const patches = vi.fn();
    server.use(
      http.patch(`${USERS}/:id`, () => {
        patches();
        return HttpResponse.json(PETE);
      }),
    );
    renderApp(`/users/${PETE.id}`);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Role'), 'team_lead');
    const save = screen.getByRole('button', { name: 'Save changes' });

    // Refused with a reason on a real focusable button, never a removed control.
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    await user.click(save);

    expect(patches).not.toHaveBeenCalled();
    expect(screen.getByText(/Another administrator has to do it/)).toBeInTheDocument();
  });

  it('shows the server’s message when the last active admin cannot be demoted', async () => {
    // Unpredictable from here: this list shows two active admins. Somebody else
    // retired Pete a second ago.
    const lists = vi.fn();
    server.use(
      http.get(USERS, () => {
        lists();
        return HttpResponse.json({ users: [PETE, BEV] });
      }),
      http.patch(`${USERS}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'The last active admin cannot be demoted or deactivated',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp(`/users/${BEV.id}`);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Role'), 'team_lead');
    const before = lists.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The last active admin cannot be demoted or deactivated',
    );
    // A refusal nobody predicted is proof this list is out of date.
    expect(lists.mock.calls.length).toBeGreaterThan(before);
  });

  it('shows an unrecognised refusal verbatim and adds nothing to it', async () => {
    // Classification rests on the server's wording, so it will one day fail. When
    // it does, the server's sentence is still the most useful thing on screen —
    // and a manufactured next step would be a guess.
    server.use(
      http.patch(`${USERS}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'Some rule nobody here has heard of',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp(`/users/${BEV.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Some rule nobody here has heard of');
    expect(alert).not.toHaveTextContent('administrator');
  });

  it('opens a retired account from the list it already has, with no second request', async () => {
    // There is no GET /users/{id}. Reactivating is the main reason to open a
    // retired row, so the list is fetched including retired and this screen is a
    // projection of it.
    const lists = vi.fn();
    server.use(
      http.get(USERS, ({ request }) => {
        lists(new URL(request.url).searchParams.get('includeInactive'));
        return HttpResponse.json({ users: [PETE, BEV, SAM] });
      }),
    );
    renderApp(`/users/${SAM.id}`);

    expect(await screen.findByRole('heading', { name: 'Amend Sam Gone' })).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(lists).toHaveBeenCalledTimes(1);
    expect(lists).toHaveBeenCalledWith('true');
  });

  it('says an unknown id is not in the list rather than crashing', async () => {
    renderApp('/users/no-such-user');

    expect(
      await screen.findByRole('heading', { name: 'That account is not in the list' }),
    ).toBeInTheDocument();
  });
});
