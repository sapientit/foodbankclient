import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AuthorisedReferrer } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REFERRERS = '/api/v1/authorised-referrers';

const DOMAIN_ROW: AuthorisedReferrer = {
  id: 'r1',
  matchType: 'domain',
  matchValue: 'guildford.gov.uk',
  organisationName: 'Guildford Council',
  isActive: true,
  notes: 'Set up by Pete',
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

describe('amending an authorised referrer', () => {
  it('shows the stored bare domain back with its "*@" re-added', async () => {
    server.use(http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [DOMAIN_ROW] })));

    renderApp('/referrers/r1');

    expect(await screen.findByText('*@guildford.gov.uk')).toBeInTheDocument();
  });

  it('saves the organisation and notes without matchType, matchValue or isActive', async () => {
    let patched: unknown = null;
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [DOMAIN_ROW] })),
      http.patch(`${REFERRERS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: 'r1', isActive: true });
      }),
    );

    renderApp('/referrers/r1');
    const user = userEvent.setup();

    const organisation = await screen.findByLabelText('Organisation');
    await user.clear(organisation);
    await user.type(organisation, 'Guildford Borough Council');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({
      organisationName: 'Guildford Borough Council',
      notes: 'Set up by Pete',
    });
    expect(
      await screen.findByRole('heading', { name: 'Authorised referrers' }),
    ).toBeInTheDocument();
  });

  it('shows a not-found state for an id that is not in the list', async () => {
    server.use(http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })));

    renderApp('/referrers/does-not-exist');

    expect(await screen.findByText('That referrer is not in the list')).toBeInTheDocument();
  });
});
