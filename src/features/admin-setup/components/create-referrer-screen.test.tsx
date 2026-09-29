import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
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

/** Stubbed in `test/setup.ts` as a tab that opened; the blocked case sets `null` itself. */
let openTab: MockInstance<typeof window.open>;

beforeEach(() => {
  // The spy `test/setup.ts` installed; spying again returns it, implementation intact.
  openTab = vi.spyOn(window, 'open');
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

describe('welcoming a newly authorised referrer', () => {
  async function authoriseEmail() {
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })),
      http.post(REFERRERS, () =>
        HttpResponse.json({ id: 'r9', matchValue: 'anna@example.org' }, { status: 201 }),
      ),
    );

    renderApp('/referrers/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'anna@example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));
  }

  it('opens a Gmail email to an exact address in the administrator’s own account, then returns to the list', async () => {
    await authoriseEmail();

    expect(
      await screen.findByRole('heading', { name: 'Authorised referrers' }),
    ).toBeInTheDocument();
    expect(openTab).toHaveBeenCalledTimes(1);
    const params = new URL(String(openTab.mock.calls[0]?.[0])).searchParams;
    expect(params.get('authuser')).toBe('pete@x.com');
    expect(params.get('to')).toBe('anna@example.org');
    // An approved-referrer entry records no person, so the greeting has no name.
    expect(params.get('body')).toMatch(/^Hi\n/);
  });

  it('never opens an email for a domain, which names nobody to write to', async () => {
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: [] })),
      http.post(REFERRERS, () =>
        HttpResponse.json({ id: 'r9', matchValue: 'example.org' }, { status: 201 }),
      ),
    );

    renderApp('/referrers/new');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Any address at a domain' }));
    await user.type(screen.getByLabelText('Domain'), 'example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    expect(
      await screen.findByRole('heading', { name: 'Authorised referrers' }),
    ).toBeInTheDocument();
    expect(openTab).not.toHaveBeenCalled();
  });

  it('stays on the screen with the email as a link when the browser blocks the new tab', async () => {
    openTab.mockReturnValue(null);

    await authoriseEmail();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The referrer is authorised. Your browser did not open the welcome email.',
    );
    expect(screen.getByRole('status')).toHaveFocus();
    const link = screen.getByRole('link', {
      name: 'Open the welcome email in Gmail (opens in a new tab)',
    });
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('to')).toBe(
      'anna@example.org',
    );
    expect(screen.getByRole('link', { name: 'Back to authorised referrers' })).toHaveAttribute(
      'href',
      '/referrers',
    );
  });
});
