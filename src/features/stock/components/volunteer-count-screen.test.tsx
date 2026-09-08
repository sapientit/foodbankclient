import { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import { getVolunteerCode, setVolunteerCode } from '../../../api/volunteer-code-store';

/**
 * The stock take on a device that never signs in. `/count` is a plain sibling of
 * the authenticated layout — no `RequireAuth`, no `AppShell` — so no test here
 * signs anybody in, and the claim is that reaching it costs an unauthenticated
 * visitor nothing.
 */

const REFRESH = '/api/v1/auth/refresh';
const LEVELS = '/api/v1/stock/levels';
const GROUPINGS = '/api/v1/stock/groupings';
const CRATES = '/api/v1/stock/crates';

const TYPED_CODE = '  kp7q-4xzm-9rtw-2njh  ';
const NORMALISED_CODE = 'KP7Q-4XZM-9RTW-2NJH';

beforeEach(() => {
  // The code is module-level state; start every test from empty.
  setVolunteerCode(null);
});

afterEach(() => {
  setVolunteerCode(null);
});

describe('the volunteer count screen', () => {
  it('asks for the counting code without restoring a session or showing app chrome', async () => {
    const refresh = vi.fn();
    server.use(
      http.post(REFRESH, () => {
        refresh();
        return HttpResponse.json({
          accessToken: 'fresh-token',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
        });
      }),
    );
    renderApp('/count');

    expect(await screen.findByLabelText('Counting code')).toBeInTheDocument();
    // No guard mounts, so nothing boots the session.
    expect(refresh).not.toHaveBeenCalled();
    // No shell: no navigation, no way to sign out.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('sends the trimmed, uppercased code as X-Volunteer-Code on the stock-take requests', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.get(LEVELS, ({ request }) => {
        seen.levels = request.headers.get('X-Volunteer-Code');
        return HttpResponse.json({ items: [] });
      }),
      http.get(GROUPINGS, ({ request }) => {
        seen.groupings = request.headers.get('X-Volunteer-Code');
        return HttpResponse.json({ items: [] });
      }),
      http.get(CRATES, ({ request }) => {
        seen.crates = request.headers.get('X-Volunteer-Code');
        return HttpResponse.json({ items: [] });
      }),
    );
    const { router } = renderApp('/count');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counting code'), TYPED_CODE);
    await user.click(screen.getByRole('button', { name: 'Start counting' }));

    // The stock take is on screen once the grouping picker renders.
    await screen.findByLabelText('Grouping');

    expect(seen.levels).toBe(NORMALISED_CODE);
    expect(seen.groupings).toBe(NORMALISED_CODE);
    expect(seen.crates).toBe(NORMALISED_CODE);

    // The code is a live credential: it travels only as a header, never in the
    // address, which would reach history and logs.
    expect(router.state.location.pathname).toBe('/count');
    expect(router.state.location.search).toBe('');
  });

  it('refuses an empty code and does not open the stock take', async () => {
    renderApp('/count');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start counting' }));

    expect(
      await screen.findByText('Enter the code your team leader gave you.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Grouping')).toBeNull();
  });

  it('returns to the code box with an expired message when the code stops working', async () => {
    server.use(
      http.get(LEVELS, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Code expired', requestId: 'r1' } },
          { status: 401 },
        ),
      ),
      http.get(GROUPINGS, () => HttpResponse.json({ items: [] })),
      http.get(CRATES, () => HttpResponse.json({ items: [] })),
    );
    renderApp('/count');
    const user = userEvent.setup();

    // Nothing has failed yet: the expiry message must be genuinely absent first.
    expect(screen.queryByText(/stopped working/i)).toBeNull();

    await user.type(await screen.findByLabelText('Counting code'), 'kp7q-4xzm-9rtw-2njh');
    await user.click(screen.getByRole('button', { name: 'Start counting' }));

    expect(await screen.findByText(/that code has stopped working/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Counting code')).toBeInTheDocument();
    expect(getVolunteerCode()).toBeNull();
  });

  it('confirms before Finish counting, then clears the code and returns to the code box', async () => {
    server.use(
      http.get(LEVELS, () => HttpResponse.json({ items: [] })),
      http.get(GROUPINGS, () => HttpResponse.json({ items: [] })),
      http.get(CRATES, () => HttpResponse.json({ items: [] })),
    );
    renderApp('/count');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counting code'), 'kp7q-4xzm-9rtw-2njh');
    await user.click(screen.getByRole('button', { name: 'Start counting' }));
    await screen.findByLabelText('Grouping');

    // The header button only opens the confirmation — a stray press does not end
    // a session the volunteer cannot restart.
    await user.click(screen.getByRole('button', { name: 'Finish counting' }));
    await user.click(screen.getByRole('button', { name: 'Keep counting' }));
    expect(screen.getByLabelText('Grouping')).toBeInTheDocument();
    expect(getVolunteerCode()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Finish counting' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finish counting' }));

    expect(await screen.findByLabelText('Counting code')).toBeInTheDocument();
    expect(getVolunteerCode()).toBeNull();
    // Finishing is not the same as a lapsed code — no expiry message.
    expect(screen.queryByText(/stopped working/i)).toBeNull();
  });

  it('lets a fresh code recover the count after the previous one lapsed', async () => {
    let levelsAuthorised = false;
    server.use(
      http.get(LEVELS, () => {
        if (!levelsAuthorised) {
          return HttpResponse.json(
            { error: { code: 'UNAUTHORIZED', message: 'Code expired', requestId: 'r1' } },
            { status: 401 },
          );
        }
        return HttpResponse.json({ items: [] });
      }),
      http.get(GROUPINGS, () => HttpResponse.json({ items: [] })),
      http.get(CRATES, () => HttpResponse.json({ items: [] })),
    );

    // The real cache policy: without `removeQueries` in `startCode`, the cached
    // 401 stays fresh for a minute and the retry loops straight back to expired.
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 60_000, retry: false },
        mutations: { retry: false },
      },
    });
    renderApp('/count', client);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Counting code'), 'old-code');
    await user.click(screen.getByRole('button', { name: 'Start counting' }));
    await screen.findByText(/that code has stopped working/i);

    // The box keeps what was typed so one wrong character can be fixed; this
    // test replaces it wholesale.
    levelsAuthorised = true;
    const box = screen.getByLabelText('Counting code');
    expect(box).toHaveValue('OLD-CODE');
    await user.clear(box);
    await user.type(box, 'new-code');
    await user.click(screen.getByRole('button', { name: 'Start counting' }));

    expect(await screen.findByLabelText('Grouping')).toBeInTheDocument();
    expect(screen.queryByText(/that code has stopped working/i)).toBeNull();
  });
});
