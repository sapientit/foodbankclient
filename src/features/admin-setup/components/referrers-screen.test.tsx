import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AuthorisedReferrer } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REFERRERS = '/api/v1/authorised-referrers';

const BLOCKED_EMAIL: AuthorisedReferrer = {
  id: 'r1',
  matchType: 'email',
  matchValue: 'anna@guildford.gov.uk',
  organisationName: 'Guildford Council',
  isActive: false,
  notes: 'Left the role — see note from Pete',
};

const ACTIVE_DOMAIN: AuthorisedReferrer = {
  id: 'r2',
  matchType: 'domain',
  matchValue: 'guildford.gov.uk',
  organisationName: 'Guildford Council',
  isActive: true,
  notes: null,
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
  );
});

describe('the authorised referrers list', () => {
  it('lists an inactive email row rather than filtering it out', async () => {
    server.use(
      http.get(REFERRERS, () =>
        HttpResponse.json({ authorisedReferrers: [BLOCKED_EMAIL, ACTIVE_DOMAIN] }),
      ),
    );

    renderApp('/referrers');

    // Never filter these out: an inactive exact-address row is a block, not
    // dead data, and has to appear on the list for that to be visible.
    expect(await screen.findByText('anna@guildford.gov.uk')).toBeInTheDocument();
    expect(screen.getByText('*@guildford.gov.uk')).toBeInTheDocument();
  });

  it('names the domain an inactive email row blocks, when that domain is still authorised', async () => {
    server.use(
      http.get(REFERRERS, () =>
        HttpResponse.json({ authorisedReferrers: [BLOCKED_EMAIL, ACTIVE_DOMAIN] }),
      ),
    );

    renderApp('/referrers');

    expect(
      await screen.findByText(
        /Blocks only this address — \*@guildford\.gov\.uk is still authorised/,
      ),
    ).toBeInTheDocument();
  });

  it('offers to deactivate an active row and reactivate an inactive one', async () => {
    server.use(
      http.get(REFERRERS, () =>
        HttpResponse.json({ authorisedReferrers: [BLOCKED_EMAIL, ACTIVE_DOMAIN] }),
      ),
    );

    renderApp('/referrers');
    await screen.findByText('anna@guildford.gov.uk');

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('deactivates a referrer through the confirmation dialog', async () => {
    let patched: unknown = null;
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [ACTIVE_DOMAIN] })),
      http.patch(`${REFERRERS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: ACTIVE_DOMAIN.id, isActive: false });
      }),
    );

    renderApp('/referrers');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Deactivate' }));

    expect(patched).toEqual({ isActive: false });
  });

  it('shows an empty state when nobody is authorised yet', async () => {
    server.use(http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })));

    renderApp('/referrers');

    expect(await screen.findByText('No authorised referrers yet')).toBeInTheDocument();
  });
});
