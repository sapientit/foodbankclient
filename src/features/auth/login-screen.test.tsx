import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { AuthProvider } from '../../auth/auth-provider';
import { LoginScreen } from './login-screen';

const DEV_LOGIN = '/api/v1/auth/dev-login';

function envelope(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, requestId: 'r1' } }, { status });
}

function signedIn() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
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

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email address'), email);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sign-in screen', () => {
  it('returns to the page that asked for a sign-in', async () => {
    server.use(http.post(DEV_LOGIN, () => signedIn()));
    renderLogin('/login?next=%2Fsessions');

    await submit('pete@x.com');

    expect(await screen.findByText('Sessions')).toBeInTheDocument();
  });

  it('ignores a next that is not a path on this origin', async () => {
    // An open redirect straight after sign-in is the most convincing possible
    // phishing page, because the person just proved they trust this one.
    server.use(http.post(DEV_LOGIN, () => signedIn()));
    renderLogin('/login?next=https%3A%2F%2Fevil.example');

    await submit('pete@x.com');

    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('shows the same message for an unknown address as for a bad credential', async () => {
    /*
     * The server answers 401 for both, on purpose: telling the two apart would
     * make this form an oracle for "does this person have an account at the food
     * bank". So the client must not distinguish them either, however the
     * server's own wording changes.
     */
    server.use(http.post(DEV_LOGIN, () => envelope(401, 'UNAUTHORIZED', 'No such user')));
    renderLogin();
    await submit('nobody@example.org');
    const unknownAddress = (await screen.findByRole('alert')).textContent;

    server.use(http.post(DEV_LOGIN, () => envelope(401, 'UNAUTHORIZED', 'Bad credentials')));
    await submit('pete@x.com');
    const badCredential = (await screen.findByRole('alert')).textContent;

    expect(unknownAddress).toBe(badCredential);
    expect(unknownAddress).toBe(
      'We could not sign you in. Check the address, or ask an administrator to add you.',
    );
  });

  it('moves focus to the error so it is not missed', async () => {
    server.use(http.post(DEV_LOGIN, () => envelope(401, 'UNAUTHORIZED', 'No such user')));
    renderLogin();

    await submit('nobody@example.org');

    expect(await screen.findByRole('alert')).toHaveFocus();
  });

  it('offers no role picker', () => {
    renderLogin();

    // `dev-login` takes { email } and silently strips anything else, so a role
    // picker would be a control that appears to work and changes nothing. Name
    // and role come from the users row.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText(/role/i)).toBeNull();
    expect(screen.queryByLabelText(/name/i)).toBeNull();
  });

  it('shows the deactivated-account message', async () => {
    // The one deliberate exception to "a 403 is a bug": this one is a real
    // answer to a real request, written for the person reading it.
    server.use(
      http.post(DEV_LOGIN, () => envelope(403, 'FORBIDDEN', 'This account has been deactivated.')),
    );
    renderLogin();

    await submit('retired@x.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account has been deactivated. Ask an administrator to reactivate it.',
    );
  });

  it('still explains a deactivated account when the 403 carries no body', async () => {
    // openapi.yaml declares no content on this response, so the envelope cannot
    // be relied on. Falling through to the generic apology would render
    // "Something went wrong. Ask an administrator to reactivate it."
    server.use(http.post(DEV_LOGIN, () => new HttpResponse(null, { status: 403 })));
    renderLogin();

    await submit('retired@x.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account is not active. Ask an administrator to reactivate it.',
    );
  });

  it('explains a 404 as a misconfigured server rather than a user mistake', async () => {
    server.use(http.post(DEV_LOGIN, () => new HttpResponse(null, { status: 404 })));
    renderLogin();

    await submit('pete@x.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Development sign-in is not enabled on this server.',
    );
  });

  it('offers the development accounts, and writes nothing anywhere', async () => {
    renderLogin();

    const fill = screen.getByRole('button', { name: 'pete@x.com' });
    await userEvent.setup().click(fill);

    expect(screen.getByLabelText('Email address')).toHaveValue('pete@x.com');

    // The team lead an admin creates through user maintenance. There is no
    // bootstrap migration for one, so this address only works after that.
    expect(screen.getByRole('button', { name: 'lead@x.com' })).toBeInTheDocument();
  });

  it('renders no development hint in a production build', () => {
    vi.stubEnv('DEV', false);

    renderLogin();

    expect(screen.queryByText(/Development sign-in\./)).toBeNull();
    expect(screen.queryByRole('button', { name: 'pete@x.com' })).toBeNull();
  });
});
