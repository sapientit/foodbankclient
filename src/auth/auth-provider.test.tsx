import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/msw/server';
import type { useAuth as UseAuth } from './auth-context';
import type { AuthProvider as AuthProviderComponent } from './auth-provider';
import type { RequireAuth as RequireAuthComponent } from './require-auth';

/**
 * Every test needs a page that has never booted, and "boot exactly once per page
 * load" is a module-level memo by design — so the module graph is what gets
 * reset, and these three bindings have to come from the fresh one or the auth
 * context they share would not be the same object. The imports above are
 * type-only and erased, so they do not pin the old graph.
 */
let AuthProvider: typeof AuthProviderComponent;
let RequireAuth: typeof RequireAuthComponent;
let useAuth: typeof UseAuth;

beforeEach(async () => {
  vi.resetModules();
  ({ AuthProvider } = await import('./auth-provider'));
  ({ RequireAuth } = await import('./require-auth'));
  ({ useAuth } = await import('./auth-context'));
});

const REFRESH = '/api/v1/auth/refresh';

function refreshedAs(displayName: string) {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName, role: 'admin' },
  });
}

function noSession() {
  return HttpResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
    { status: 401 },
  );
}

function Greeting() {
  const { state } = useAuth();
  return <p>{state.status === 'signed-in' ? `Hello ${state.user.displayName}` : state.status}</p>;
}

function LoginStub() {
  const [params] = useSearchParams();
  return <p>Sign in, then back to {params.get('next')}</p>;
}

function renderApp(children: ReactNode, wrapper: (tree: ReactNode) => ReactNode = (tree) => tree) {
  return render(
    wrapper(
      <MemoryRouter initialEntries={['/sessions?week=2']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginStub />} />
            <Route path="/sessions" element={<RequireAuth>{children}</RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    ),
  );
}

describe('AuthProvider', () => {
  it('restores the session from the refresh cookie on reload', async () => {
    server.use(http.post(REFRESH, () => refreshedAs('Pete Bennett')));

    renderApp(<Greeting />);

    // Not the sign-in screen while it happens — that flash is what the
    // `restoring` state exists to prevent.
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in');

    expect(await screen.findByText('Hello Pete Bennett')).toBeInTheDocument();
  });

  it('keeps the display name across a reload', async () => {
    // The concrete argument against booting on `GET /auth/me`: that endpoint
    // returns only { id, email, role }. Booting on it would either lose the name
    // or need a second request to get it back, and it would 401 first anyway
    // because a reload leaves no access token in memory.
    server.use(http.post(REFRESH, () => refreshedAs('Pete Bennett')));

    renderApp(<Greeting />);

    expect(await screen.findByText('Hello Pete Bennett')).toBeInTheDocument();
  });

  it('boots exactly once under StrictMode', async () => {
    let refreshes = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return refreshedAs('Pete Bennett');
      }),
    );

    // StrictMode double-invokes effects. Without the module-level memo the guard
    // fires two refreshes, the server reads the second as a replayed token,
    // revokes the family, and every development reload signs you out.
    renderApp(<Greeting />, (tree) => <StrictMode>{tree}</StrictMode>);

    expect(await screen.findByText('Hello Pete Bennett')).toBeInTheDocument();
    expect(refreshes).toBe(1);
  });

  it('sends someone with no session to /login with the path to come back to', async () => {
    server.use(http.post(REFRESH, () => noSession()));

    renderApp(<Greeting />);

    expect(await screen.findByText(/Sign in, then back to/)).toHaveTextContent('/sessions?week=2');
  });

  it('does not restore the session until a guarded route asks it to', async () => {
    let refreshes = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return refreshedAs('Pete Bennett');
      }),
    );

    // The provider wraps the public referral form too. An unauthenticated
    // referrer must not pay for a round trip to /auth/refresh that can only
    // fail — which is why the boot lives in the route guard.
    render(
      <MemoryRouter initialEntries={['/refer']}>
        <AuthProvider>
          <p>Refer someone</p>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Refer someone')).toBeInTheDocument();
    expect(refreshes).toBe(0);
  });
});
