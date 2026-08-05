import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AdminReferralReason } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REASONS = '/api/v1/referral-reasons';

const ACTIVE: AdminReferralReason = {
  id: 'q1',
  code: 'financial_hardship',
  label: 'Financial hardship',
  displayOrder: 0,
  isActive: true,
};

const RETIRED: AdminReferralReason = {
  id: 'q2',
  code: 'old_reason',
  label: 'Old reason',
  displayOrder: 1,
  isActive: false,
};

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

describe('the reasons for referral list', () => {
  it('shows a retired reason alongside active ones, not hidden behind a toggle', async () => {
    server.use(http.get(REASONS, () => HttpResponse.json({ referralReasons: [ACTIVE, RETIRED] })));

    renderApp('/referral-reasons');

    expect(await screen.findByText('Financial hardship')).toBeInTheDocument();
    expect(screen.getByText('Old reason')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });

  it('retires an active reason through the confirmation dialog', async () => {
    let patched: unknown = null;
    server.use(
      http.get(REASONS, () => HttpResponse.json({ referralReasons: [ACTIVE] })),
      http.patch(`${REASONS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...ACTIVE, isActive: false });
      }),
    );

    renderApp('/referral-reasons');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Retire' }));

    expect(patched).toEqual({ isActive: false });
  });

  it('restores a retired reason with no confirmation dialog', async () => {
    let patched: unknown = null;
    server.use(
      http.get(REASONS, () => HttpResponse.json({ referralReasons: [RETIRED] })),
      http.patch(`${REASONS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...RETIRED, isActive: true });
      }),
    );

    renderApp('/referral-reasons');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(patched).toEqual({ isActive: true });
  });
});
