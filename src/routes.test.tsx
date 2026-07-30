import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw/server';
import type { AuthProvider as AuthProviderComponent } from './auth/auth-provider';
import { RouteError } from './components/route-error';
import { ApiError } from './lib/errors';

/**
 * The route table as a user meets it.
 *
 * Every test needs a page that has never booted, and "boot exactly once per page
 * load" is a module-level memo by design — so the module graph is reset and both
 * bindings come from the fresh one, or the auth context they share would not be
 * the same object.
 */
let routes: RouteObject[];
let AuthProvider: typeof AuthProviderComponent;

beforeEach(async () => {
  vi.resetModules();
  ({ routes } = await import('./routes'));
  ({ AuthProvider } = await import('./auth/auth-provider'));
});

const REFRESH = '/api/v1/auth/refresh';
const DEV_LOGIN = '/api/v1/auth/dev-login';
const PUBLIC_SESSIONS = '/api/v1/public/sessions';

function signedInAs(role: 'admin' | 'team_lead') {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'lead@x.com', displayName: 'Ada Lead', role },
  });
}

function noSession() {
  return HttpResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
    { status: 401 },
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return router;
}

describe('routing', () => {
  it('renders a 404 screen for an unknown path', async () => {
    /*
     * The one that matters most, because the server cannot help. With
     * `not_found_handling: "single-page-application"` an unknown path returns
     * index.html with HTTP 200, so a mistyped link would otherwise boot the app,
     * match nothing and render a blank page.
     */
    renderAt('/no-such-page');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('issues no auth request for the public referral route', async () => {
    const refreshes = vi.fn();
    const publicCalls = vi.fn();
    server.use(
      http.post(REFRESH, () => {
        refreshes();
        return signedInAs('admin');
      }),
      http.get(PUBLIC_SESSIONS, () => {
        publicCalls();
        return HttpResponse.json({ sessions: [] });
      }),
    );

    // The structural guarantee that keeps the public flow unblocked: /refer is a
    // sibling of the authenticated layout, so it never mounts the route guard,
    // so nothing triggers the session restore. A referrer has no account and
    // must not wait on a round trip that could only fail.
    renderAt('/refer');

    expect(
      await screen.findByRole('heading', { name: 'Refer someone to the food bank' }),
    ).toBeInTheDocument();

    // The page now really does call the API, which is what makes the assertion
    // below worth something: it is not "no requests", it is "no *auth* requests
    // even while the screen is fetching".
    await screen.findByRole('heading', { name: 'No sessions have space at the moment' });
    expect(publicCalls).toHaveBeenCalled();
    expect(refreshes).not.toHaveBeenCalled();

    // And no shell: no nav, no sign-out control, nothing implying an account.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('keeps the whole public referral path off the guard and out of the 404', async () => {
    const refreshes = vi.fn();
    server.use(
      http.post(REFRESH, () => {
        refreshes();
        return signedInAs('admin');
      }),
      http.get(PUBLIC_SESSIONS, () => HttpResponse.json({ sessions: [] })),
    );

    // The real flow has steps under /refer — the form, the confirmation, the
    // fifteen-minute edit window — and the splat is what stops any of them
    // falling through to the catch-all or into the authenticated layout.
    renderAt('/refer/confirm');

    expect(
      await screen.findByRole('heading', { name: 'Refer someone to the food bank' }),
    ).toBeInTheDocument();
    expect(refreshes).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to the login screen with a next path', async () => {
    server.use(http.post(REFRESH, () => noSession()));

    const router = renderAt('/sessions');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fsessions');
  });

  it('returns them to where they were after signing in', async () => {
    server.use(
      http.post(REFRESH, () => noSession()),
      http.post(DEV_LOGIN, () => signedInAs('team_lead')),
    );

    renderAt('/sessions');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'lead@x.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('shows the sign-in screen without the shell', async () => {
    server.use(http.post(REFRESH, () => noSession()));

    renderAt('/login');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('route error boundary', () => {
  it('renders the shared error surface instead of a stack trace', async () => {
    function Throws(): never {
      throw new ApiError({
        status: 409,
        code: 'CONFLICT',
        message: 'That session is full',
        requestId: 'r1',
        details: null,
      });
    }

    // React logs a caught render error whatever the boundary does; the point of
    // the assertion is what the volunteer sees instead of that.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const router = createMemoryRouter([
      { path: '/', element: <Throws />, errorElement: <RouteError /> },
    ]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('That session is full');
  });
});
