import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { AuthorisedReferrer } from './queries';

/**
 * `POST /authorised-referrers` answers `{ id, matchValue }` — no
 * `organisationName`, no `isActive`, nothing to splice into the cached list
 * the way `users.ts` and `model-parcels.ts` do with their mutation
 * responses. `useAuthoriseReferrer` invalidates instead, so the newly
 * authorised referrer has to come from a refetch.
 *
 * This test builds its own query client with the app's real `staleTime`
 * rather than `renderApp`'s default of zero — see
 * `stock-invalidation.test.tsx` for why the default would make the
 * assertion pass whether or not anything was actually invalidated: every
 * remount refetches under `staleTime: 0`, so the list showing the new row
 * would prove nothing about whether `create` correctly invalidated it.
 */
const REFRESH = '/api/v1/auth/refresh';
const REFERRERS = '/api/v1/authorised-referrers';

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
}

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

describe('authorising a referrer with a response that carries no full row', () => {
  it('shows the new referrer on the list without a page reload', async () => {
    let rows: AuthorisedReferrer[] = [];
    server.use(
      http.get(REFERRERS, () => HttpResponse.json({ authorisedReferrers: rows })),
      http.post(REFERRERS, async ({ request }) => {
        const body = (await request.json()) as {
          matchType: 'email' | 'domain';
          matchValue: string;
          organisationName: string;
          notes: string | null;
        };
        const created: AuthorisedReferrer = {
          id: 'r9',
          matchType: body.matchType,
          matchValue: body.matchValue,
          organisationName: body.organisationName,
          isActive: true,
          notes: body.notes,
        };
        rows = [...rows, created];
        // Deliberately the contract's real shape: not the full row.
        return HttpResponse.json(
          { id: created.id, matchValue: created.matchValue },
          { status: 201 },
        );
      }),
    );

    const { router } = renderApp('/referrers/new', cachingClient());
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email address'), 'anna@example.org');
    await user.type(screen.getByLabelText('Organisation'), 'Example Org');
    await user.click(screen.getByRole('button', { name: 'Authorise referrer' }));

    await screen.findByRole('heading', { name: 'Authorised referrers' });

    // The cache is fresh for another minute, so this can only be here if
    // authorising the referrer invalidated the list query — a plain
    // `setQueryData` splice was never possible, since the response has
    // nothing to splice in.
    expect(await screen.findByText('anna@example.org')).toBeInTheDocument();

    // Confirms the navigation actually reused the cached client rather than
    // a fresh one that would trivially refetch regardless.
    expect(router.state.location.pathname).toBe('/referrers');
  });
});
