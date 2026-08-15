import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw/server';
import type { queryClient as QueryClientSingleton } from './api/query-client';
import type { App as AppComponent } from './app';
import type { referralKeys as ReferralKeys } from './features/referrals/keys';
import type { Referral } from './features/referrals/queries';

/**
 * The composition root end to end, with nothing mocked out but the API: the
 * query client, the auth provider and the real browser router, booting the way a
 * browser boots them. When this fails the problem is the wiring, not a screen.
 *
 * **The real `queryClient` singleton is the point of this file.** Every other
 * screen test gets a throwaway client from `test/render-app.tsx`, so anything
 * about the app's *one* cache — its real `staleTime`, and what survives a
 * sign-out — can only be proved here.
 *
 * A boot is memoised per module graph (`ensureSession`), and `createBrowserRouter`
 * reads the location when `routes.tsx` is first imported. So each test resets the
 * module graph and sets the URL before importing, through `bootAt` below.
 */
let App: typeof AppComponent;
let queryClient: typeof QueryClientSingleton;
let referralKeys: typeof ReferralKeys;

beforeEach(() => {
  vi.resetModules();
});

const REFRESH = '/api/v1/auth/refresh';
const REFERRALS = '/api/v1/referrals';
const SESSIONS = '/api/v1/sessions';

async function bootAt(path: string) {
  window.history.pushState({}, '', path);
  ({ App } = await import('./app'));
  ({ queryClient } = await import('./api/query-client'));
  ({ referralKeys } = await import('./features/referrals/keys'));
  render(<App />);
}

function unauthorized() {
  return HttpResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
    { status: 401 },
  );
}

function signedIn() {
  return HttpResponse.json({
    accessToken: 'fresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
  });
}

const JAMIE: Referral = {
  id: 'r1',
  sessionId: 's1',
  status: 'active',
  referredAt: '2026-07-01T10:00:00.000Z',
  adults: 2,
  children: 1,
  householdSize: 3,
  isDelivery: false,
  needsFuelHelp: false,
  referrerOrganisation: 'Riverside Church',
  referrerName: 'Sam Referrer',
  refereeFirstName: 'Jamie',
  refereeSurname: 'Rowe',
  refereeDateOfBirth: '1985-03-12',
  refereeAddress: '1 Elm Street',
  refereePostcode: 'AB1 2CD',
  refereePhone: null,
  answers: {},
  piiPurgedAt: null,
};

describe('App', () => {
  it('boots and lands a visitor with no session on the sign-in screen', async () => {
    server.use(http.post(REFRESH, () => unauthorized()));

    await bootAt('/');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('empties the cache when a lapsed sign-in ends the session, not only when someone signs out', async () => {
    /*
     * The shared-laptop failure this guards. A volunteer is working through the
     * referral list; their sign-in lapses; the next request 401s, the refresh
     * cookie is gone, and the app signs them out. The households they were
     * looking at are named, addressed and phoned, and the person who signs in
     * next is a different volunteer.
     *
     * `signOut()` in `auth/session.ts` clears the cache for exactly this reason,
     * but it is only one of the two ways a session ends — `endSession()` in
     * `api/auth-fetch.ts` is the other, and it is the one nobody chooses.
     * `features/referrals/keys.ts` states the invariant both have to keep: "the
     * query client is cleared on sign out".
     */
    let refreshes = 0;
    let lists = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        // The first is the boot. By the second, the sign-in has lapsed.
        return refreshes === 1 ? signedIn() : unauthorized();
      }),
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.get(REFERRALS, () => {
        lists += 1;
        return lists === 1 ? HttpResponse.json({ referrals: [JAMIE] }) : unauthorized();
      }),
    );

    await bootAt('/referrals');

    expect(await screen.findByText('Rowe, Jamie')).toBeInTheDocument();
    expect(queryClient.getQueryData(referralKeys.list({}))).toBeDefined();

    // Filtering asks for a list the cache does not hold, which is the request
    // whose 401 discovers that the sign-in is over.
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'reviewed');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Rowe, Jamie')).toBeNull();
    expect(queryClient.getQueryData(referralKeys.list({}))).toBeUndefined();
  });
});
