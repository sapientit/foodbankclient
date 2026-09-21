import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { AuthProvider } from '../../auth/auth-provider';
import { reloadForNewerClient } from '../../lib/client-version';
import { LoginScreen } from './login-screen';

vi.mock('../../lib/client-version', () => ({
  reloadForNewerClient: vi.fn().mockResolvedValue(false),
}));

const GOOGLE_LOGIN = '/api/v1/auth/google-login';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function envelope(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, requestId: 'r1' } }, { status });
}

function signedIn(role: 'admin' | 'fuel_admin' = 'admin') {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@guildfordfoodbank.org', displayName: 'Pete Bennett', role },
  });
}

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/sessions" element={<p>Sessions</p>} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Google's own script is never loaded in this suite — jsdom has no network,
 * and none of this is what these tests are about. `window.google` is stood
 * up as a minimal double before each render, capturing the callback
 * `renderButton` would otherwise wire to Google's real button so a test can
 * invoke it directly, exactly as Google calling back with a credential would.
 */
let capturedCallback: ((response: { credential?: string }) => void) | undefined;

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_MODE', 'google');
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
  capturedCallback = undefined;

  window.google = {
    accounts: {
      // @ts-expect-error -- oauth2 is not exercised by this screen; only `id` is under test.
      oauth2: {},
      id: {
        initialize: ({ callback }) => {
          capturedCallback = callback;
        },
        renderButton: () => undefined,
      },
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, 'google');
  vi.mocked(reloadForNewerClient).mockReset();
  vi.mocked(reloadForNewerClient).mockResolvedValue(false);
});

/**
 * `GoogleSignInButton` wires the button up inside a `.then()` after the
 * (already-resolved, since `window.google` is stood up before render) script
 * load promise — a microtask, not synchronous with mount. Waiting for the
 * capture is what a real Google button loading asynchronously would also
 * require of a caller.
 */
async function fireCredential(idToken: string) {
  await waitFor(() => {
    if (capturedCallback === undefined) throw new Error('Google button has not initialised yet');
  });
  capturedCallback?.({ credential: idToken });
}

describe('Google sign-in screen', () => {
  it('shows the Foodbank banner and no email form', () => {
    renderLogin();

    expect(screen.getByRole('img', { name: 'Foodbank logo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });

  it('signs in and navigates on a valid credential', async () => {
    server.use(http.post(GOOGLE_LOGIN, () => signedIn()));
    renderLogin();

    await fireCredential('a-real-looking-id-token');

    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('sends the credential as idToken, nothing else', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(GOOGLE_LOGIN, async ({ request }) => {
        receivedBody = await request.json();
        return signedIn();
      }),
    );
    renderLogin();

    await fireCredential('a-real-looking-id-token');

    await screen.findByText('Home');
    expect(receivedBody).toEqual({ idToken: 'a-real-looking-id-token' });
  });

  it('explains a refused address without saying whether it is registered', async () => {
    server.use(
      http.post(GOOGLE_LOGIN, () => envelope(401, 'UNAUTHORIZED', 'Authentication failed')),
    );
    renderLogin();

    await fireCredential('a-real-looking-id-token');

    expect(
      await screen.findByText(
        'We could not sign you in. Ask an administrator to add your Google account.',
      ),
    ).toBeInTheDocument();
  });

  it('explains a deactivated account', async () => {
    server.use(
      http.post(GOOGLE_LOGIN, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'This account is retired.' } },
          { status: 403 },
        ),
      ),
    );
    renderLogin();

    await fireCredential('a-real-looking-id-token');

    expect(
      await screen.findByText('This account is retired. Ask an administrator to reactivate it.'),
    ).toBeInTheDocument();
  });

  it('explains a server with Google sign-in disabled', async () => {
    server.use(http.post(GOOGLE_LOGIN, () => new HttpResponse(null, { status: 404 })));
    renderLogin();

    await fireCredential('a-real-looking-id-token');

    expect(
      await screen.findByText(
        'Google sign-in is not enabled on this server. Tell whoever deployed it.',
      ),
    ).toBeInTheDocument();
  });

  it('returns to the page that asked for a sign-in', async () => {
    server.use(http.post(GOOGLE_LOGIN, () => signedIn()));
    renderLogin('/login?next=%2Fsessions');

    await fireCredential('a-real-looking-id-token');

    expect(await screen.findByText('Sessions')).toBeInTheDocument();
  });
});
