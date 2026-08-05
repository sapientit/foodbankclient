import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AdminReferralReason } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REASONS = '/api/v1/referral-reasons';

const REASON: AdminReferralReason = {
  id: 'q1',
  code: 'financial_hardship',
  label: 'Financial hardship',
  displayOrder: 0,
  isActive: true,
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

describe('amending a reason for referral', () => {
  it('sends no code field when amending — only label and displayOrder', async () => {
    let patched: unknown = null;
    server.use(
      http.get(REASONS, () => HttpResponse.json({ referralReasons: [REASON] })),
      http.patch(`${REASONS}/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...REASON, label: 'Money worries' });
      }),
    );

    renderApp('/referral-reasons/q1');
    const user = userEvent.setup();

    const label = await screen.findByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Money worries');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patched).toEqual({ label: 'Money worries', displayOrder: 0 });
    expect(patched).not.toHaveProperty('code');
    expect(
      await screen.findByRole('heading', { name: 'Reasons for referral' }),
    ).toBeInTheDocument();
  });

  it('shows the code as read-only static text, never as an editable field', async () => {
    server.use(http.get(REASONS, () => HttpResponse.json({ referralReasons: [REASON] })));

    renderApp('/referral-reasons/q1');

    expect(await screen.findByText('financial_hardship')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('shows a not-found state for an id that is not in the list', async () => {
    server.use(http.get(REASONS, () => HttpResponse.json({ referralReasons: [] })));

    renderApp('/referral-reasons/does-not-exist');

    expect(await screen.findByText('That reason is not in the list')).toBeInTheDocument();
  });
});
