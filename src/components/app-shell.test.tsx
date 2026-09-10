import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/msw/server';
import type { AuthProvider as AuthProviderComponent } from '../auth/auth-provider';

/**
 * The shell is exercised through the real route table rather than mounted on its
 * own: it renders inside `RequireAuth`, and the thing worth testing is what a
 * signed-in volunteer meets — their permitted primary tabs, contextual links,
 * and the selected destination.
 */
let routes: RouteObject[];
let AuthProvider: typeof AuthProviderComponent;

beforeEach(async () => {
  vi.resetModules();
  ({ routes } = await import('../routes'));
  ({ AuthProvider } = await import('../auth/auth-provider'));
});

const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';

function signedInAs(role: 'admin' | 'team_lead') {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'ada@x.com', displayName: 'Ada Lead', role },
  });
}

async function renderShell(role: 'admin' | 'team_lead', path = '/sessions') {
  server.use(
    http.post(REFRESH, () => signedInAs(role)),
    // The default path renders the sessions screen, which fetches on mount.
    http.get('/api/v1/sessions', () => HttpResponse.json({ sessions: [] })),
    http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
    http.get('/api/v1/stock/items/low-stock-summary', () =>
      HttpResponse.json({ lowStockCount: 0 }),
    ),
    http.get('/api/v1/sms-messages/attention-summary', () => HttpResponse.json({ unreadTotal: 0 })),
  );

  const router = createMemoryRouter(routes, { initialEntries: [path] });

  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );

  await screen.findByRole('navigation', { name: 'Main navigation' });
  return router;
}

function navLabels(): string[] {
  return screen
    .getAllByRole('link')
    .map((link) => link.textContent)
    .filter((label) => label !== 'Food Bank' && label !== 'Skip to main content');
}

describe('AppShell', () => {
  it('shows a team lead their permitted tabs and not Sessions', async () => {
    await renderShell('team_lead', '/stock');

    const tabs = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    const links = navLabels();
    expect(tabs.getByRole('link', { name: 'Run a session' })).toBeInTheDocument();
    expect(links).toContain('Stock');
    expect(tabs.queryByRole('link', { name: 'Sessions' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Section navigation' })).toHaveTextContent(
      'Stock take',
    );
    expect(links).not.toContain('Stock items');
  });

  it('offers an administrator the requested primary tabs without a legacy menu', async () => {
    await renderShell('admin', '/');
    const tabs = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(tabs.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(tabs.getByRole('link', { name: 'Referrals' })).toBeInTheDocument();
    expect(tabs.getByRole('link', { name: 'Stock' })).toBeInTheDocument();
    expect(tabs.getByRole('link', { name: 'Sessions' })).toBeInTheDocument();
    expect(tabs.getByRole('link', { name: 'Master Data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('makes every former administrator menu destination available as a contextual subtab', async () => {
    const cases = [
      [
        '/referrals',
        ['Check referrals', 'Search referrals', 'Send to Sheets', 'SMS Messages', 'Fuel'],
      ],
      ['/stock', ['Stock', 'Stock take', 'Stock items', 'Model parcels', 'Parcel Grid']],
      ['/sessions', ['Manage Sessions', 'Weekly sessions']],
      [
        '/referrers',
        ['Approved referrers', 'Users', 'Reasons for Crisis', 'Rule check', 'Christmas vouchers'],
      ],
    ] as const;

    for (const [path, labels] of cases) {
      await renderShell('admin', path);
      const navigation = within(screen.getByRole('navigation', { name: 'Section navigation' }));
      for (const label of labels)
        expect(navigation.getByRole('link', { name: label })).toBeInTheDocument();
      cleanup();
    }
  });

  it('marks the exact contextual destination for the current screen', async () => {
    await renderShell('admin', '/stock/items');

    // NavLink sets aria-current, and the stylesheet hangs off that attribute, so
    // what a screen reader announces and what a volunteer sees cannot drift.
    const section = within(screen.getByRole('navigation', { name: 'Section navigation' }));
    expect(section.getByRole('link', { name: 'Stock items', current: 'page' })).toBeInTheDocument();
    expect(section.getByRole('link', { name: 'Stock' })).not.toHaveAttribute('aria-current');
  });

  it('puts the primary navigation before the account block, in reading order', async () => {
    await renderShell('admin');

    // screenDetails.md, "#Menus": the primary tabs sit on the logo's line, to
    // the right of it and before the user/Sign out. Tab order must match that,
    // so navigation is reached before the control that ends the session.
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(nav.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the home link from its text, not the decorative logo', async () => {
    await renderShell('admin');

    // The logo is `alt=""` — the visible "Food Bank" text in the same link is
    // the accessible name, and the mark must not be announced on top of it.
    expect(screen.getByRole('link', { name: 'Food Bank' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('img', { name: /logo/i })).toBeNull();
  });

  it('offers a skip link to the main content', async () => {
    await renderShell('admin');

    // The first stop for a keyboard user on every screen in the app.
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('returns a signed-in visitor from an obsolete path to the dashboard', async () => {
    const router = await renderShell('admin');
    await router.navigate('/former-menu-screen');

    expect(
      await screen.findByRole('link', { name: 'Dashboard', current: 'page' }),
    ).toBeInTheDocument();
  });

  it('names the signed-in volunteer', async () => {
    await renderShell('team_lead');

    expect(screen.getByText('Ada Lead')).toBeInTheDocument();
  });

  it('returns to the sign-in screen on sign out', async () => {
    await renderShell('admin');
    server.use(http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
