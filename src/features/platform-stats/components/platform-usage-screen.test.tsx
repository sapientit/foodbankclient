import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { addCalendarDays } from '../../../lib/london-time';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { PlatformStatsDay } from '../queries';

const USAGE = '/api/v1/platform-stats/usage';

function usageDay(overrides: Partial<PlatformStatsDay> = {}): PlatformStatsDay {
  return {
    date: '2026-09-10',
    workerRequestsAccountWide: { value: 100, cap: 100_000, threshold: 80_000, exceeded: false },
    workerRequestsThisApp: { value: 50 },
    workerErrorsThisApp: { value: 0, threshold: 0, exceeded: false },
    workerCpuTimeP99Us: { value: 10, cap: 10_000 },
    workerSubrequestsAvgPerInvocation: { value: 1, cap: 50, threshold: 40, exceeded: false },
    workerWallTimeP99Ms: { value: 20 },
    d1RowsRead: { value: 100, cap: 5_000_000, threshold: 4_000_000, exceeded: false },
    d1RowsWritten: { value: 10, cap: 100_000, threshold: 80_000, exceeded: false },
    d1StorageBytes: { value: 1000, cap: 5_000_000_000, threshold: 4_000_000_000, exceeded: false },
    ...overrides,
  };
}

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'admin', email: 'admin@example.test', displayName: 'Ada Admin', role: 'admin' },
      }),
    ),
  );
});

describe('the Cloudflare statistics screen', () => {
  it('requests the default inclusive fourteen UTC days', async () => {
    let requestedUrl = '';
    server.use(
      http.get(USAGE, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ days: [] });
      }),
    );

    renderApp('/platform-stats/usage');
    expect(
      await screen.findByRole('heading', { name: 'Cloudflare statistics' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(requestedUrl).not.toBe('');
    });
    const url = new URL(requestedUrl);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(addCalendarDays(from ?? '', 13)).toBe(to);
  });

  it('states that a selected range cannot exceed fifty days and does not request it', async () => {
    const requestedRanges: string[] = [];
    server.use(
      http.get(USAGE, ({ request }) => {
        requestedRanges.push(request.url);
        return HttpResponse.json({ days: [] });
      }),
    );
    renderApp('/platform-stats/usage');

    const to = await screen.findByLabelText('To');
    const toValue = (to as HTMLInputElement).value;
    await screen.findByText('No Cloudflare usage captured');
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: addCalendarDays(toValue, -50) },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a date range of no more than 50 days.',
    );
    expect(screen.queryByText('No Cloudflare usage captured')).toBeNull();
    await waitFor(() => {
      expect(requestedRanges).toHaveLength(1);
    });
  });

  it('shows each date’s text status and expands threshold detail with exceeded rows plainly marked', async () => {
    server.use(
      http.get(USAGE, () =>
        HttpResponse.json({
          days: [
            usageDay(),
            usageDay({
              date: '2026-09-11',
              d1RowsRead: {
                value: 4_000_000,
                cap: 5_000_000,
                threshold: 4_000_000,
                exceeded: true,
              },
              workerErrorsThisApp: { value: 1, threshold: 0, exceeded: true },
            }),
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/platform-stats/usage');

    const allOk = await screen.findByRole('button', { name: /All OK/ });
    const exceeded = screen.getByRole('button', { name: /Something exceeded/ });
    expect(allOk).toHaveAttribute('aria-expanded', 'false');
    expect(exceeded).toHaveAttribute('aria-expanded', 'false');

    await user.click(exceeded);
    expect(exceeded).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByRole('table', { name: /Cloudflare usage for/ });
    expect(within(table).getByRole('columnheader', { name: 'Criterion' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Cap' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Threshold' })).toBeInTheDocument();
    const flagged = within(table).getByRole('row', { name: /D1 rows read.*5,000,000.*Exceeded/ });
    expect(within(flagged).getByText('Exceeded')).toBeInTheDocument();
    expect(within(flagged).getAllByText('4,000,000')).toHaveLength(2);
    expect(
      within(table).getByRole('row', { name: /Worker errors \(this app\).*1.*Exceeded/ }),
    ).toBeInTheDocument();
    const informational = within(table).getByRole('row', {
      name: /Worker requests \(this app\).*Informational/,
    });
    expect(within(informational).getByText('Informational')).toBeInTheDocument();
    expect(within(informational).getAllByText('No threshold')).toHaveLength(1);
    expect(
      within(table).getByRole('row', {
        name: /Worker CPU time p99.*10,000.*No threshold.*Informational/,
      }),
    ).toBeInTheDocument();

    await user.click(exceeded);
    expect(exceeded).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: /Cloudflare usage for/ })).toBeNull();
  });
});
