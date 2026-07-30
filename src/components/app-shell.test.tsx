import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/msw/server';
import type { AuthProvider as AuthProviderComponent } from '../auth/auth-provider';

/**
 * The shell is exercised through the real route table rather than mounted on its
 * own: it renders inside `RequireAuth`, and the thing worth testing is what a
 * signed-in volunteer meets — which menu, which link is marked current, and
 * whether a phone-sized disclosure behaves.
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
  server.use(http.post(REFRESH, () => signedInAs(role)));

  render(
    <AuthProvider>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AuthProvider>,
  );

  await screen.findByRole('navigation', { name: 'Main' });
}

function navLabels(): string[] {
  return screen
    .getAllByRole('link')
    .map((link) => link.textContent)
    .filter((label) => label !== 'Food Bank' && label !== 'Skip to main content');
}

describe('AppShell', () => {
  it('shows a team lead their menu and not an admin’s', async () => {
    await renderShell('team_lead');

    const links = navLabels();
    expect(links).toContain('Stock');
    expect(links).not.toContain('Stock items');
    expect(links).not.toContain('Users');
  });

  it('shows an admin the maintenance items a team lead does not get', async () => {
    await renderShell('admin');

    const links = navLabels();
    expect(links).toContain('Stock items');
    expect(links).toContain('Users');
  });

  it('marks the link for the current screen', async () => {
    await renderShell('admin', '/stock/items');

    // NavLink sets aria-current, and the stylesheet hangs off that attribute, so
    // what a screen reader announces and what a volunteer sees cannot drift.
    expect(screen.getByRole('link', { name: 'Stock items', current: 'page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock' })).not.toHaveAttribute('aria-current');
  });

  it('offers a skip link to the main content', async () => {
    await renderShell('admin');

    // The first stop for a keyboard user on every screen in the app.
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('opens and closes the small-screen menu from the keyboard', async () => {
    await renderShell('admin');
    const user = userEvent.setup();

    const disclosure = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveAttribute('aria-controls', nav.id);

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Escape must both close it and put focus back where it came from, or a
    // keyboard user is left on a control that no longer exists.
    await user.keyboard('{Escape}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveFocus();
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
