import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AuthorisedReferrer } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REFERRERS = '/api/v1/authorised-referrers';

const EXISTING: AuthorisedReferrer = {
  id: 'r1',
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

describe('authorising a referrer', () => {
  it('sends "*@example.org" typed for a domain as the bare "example.org"', async () => {
    let posted: unknown = null;
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })),
      http.post(REFERRERS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'r9', matchValue: 'example.org' }, { status: 201 });
      }),
    );

    renderApp('/referrers/new');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Any address at a domain' }));
    await user.type(screen.getByLabelText('Domain'), '*@example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    expect(posted).toEqual({
      matchType: 'domain',
      matchValue: 'example.org',
      organisationName: 'Example Org',
      notes: null,
    });
    expect(
      await screen.findByRole('heading', { name: 'Authorised referrers' }),
    ).toBeInTheDocument();
  });

  it('authorises an exact email address', async () => {
    let posted: unknown = null;
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })),
      http.post(REFERRERS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'r9', matchValue: 'anna@example.org' }, { status: 201 });
      }),
    );

    renderApp('/referrers/new');
    const user = userEvent.setup();

    // Email is the default choice, so no radio click is needed here.
    await user.type(await screen.findByLabelText('Email address'), 'anna@example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    expect(posted).toEqual({
      matchType: 'email',
      matchValue: 'anna@example.org',
      organisationName: 'Example Org',
      notes: null,
    });
  });

  it('offers to amend the existing entry instead of creating a same-domain duplicate', async () => {
    server.use(http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [EXISTING] })));

    renderApp('/referrers/new');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Any address at a domain' }));
    await user.type(screen.getByLabelText('Domain'), '*@guildford.gov.uk');

    expect(screen.getByText(/already/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Authorise referrer' });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a conflict from the server verbatim when the pre-check could not have caught it', async () => {
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })),
      http.post(REFERRERS, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That referrer is already on the list',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrers/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email address'), 'anna@example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referrer is already on the list',
    );
  });

  it('rejects an invalid email address before submitting', async () => {
    server.use(http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })));

    renderApp('/referrers/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email address'), 'not-an-email');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
  });
});
