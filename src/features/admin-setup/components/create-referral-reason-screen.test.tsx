import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AdminReferralReason } from '../queries';

const REFRESH = '/api/v1/auth/refresh';
const REASONS = '/api/v1/referral-reasons';

const EXISTING: AdminReferralReason = {
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

describe('adding a reason for referral', () => {
  it('creates the reason with its code, label and display order', async () => {
    let posted: unknown = null;
    server.use(
      http.get(REASONS, () => HttpResponse.json({ referralReasons: [] })),
      http.post(REASONS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            id: 'q9',
            code: 'domestic_abuse',
            label: 'Domestic abuse',
            displayOrder: 2,
            isActive: true,
          },
          { status: 201 },
        );
      }),
    );

    renderApp('/referral-reasons/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Code'), 'domestic_abuse');
    await user.type(screen.getByLabelText('Label'), 'Domestic abuse');
    const order = screen.getByLabelText('Display order');
    await user.clear(order);
    await user.type(order, '2');
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    expect(posted).toEqual({ code: 'domestic_abuse', label: 'Domestic abuse', displayOrder: 2 });
    expect(
      await screen.findByRole('heading', { name: 'Reasons for referral' }),
    ).toBeInTheDocument();
  });

  it('rejects a code with characters outside lowercase letters, numbers and underscores', async () => {
    server.use(http.get(REASONS, () => HttpResponse.json({ referralReasons: [] })));

    renderApp('/referral-reasons/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Code'), 'Domestic Abuse!');
    await user.type(screen.getByLabelText('Label'), 'Domestic abuse');
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    expect(
      await screen.findByText('Use lowercase letters, numbers and underscores only.'),
    ).toBeInTheDocument();
  });

  it('offers to amend the existing reason instead of creating a same-code duplicate', async () => {
    server.use(http.get(REASONS, () => HttpResponse.json({ referralReasons: [EXISTING] })));

    renderApp('/referral-reasons/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Code'), 'financial_hardship');

    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add reason' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows a conflict from the server verbatim when the pre-check could not have caught it', async () => {
    server.use(
      http.get(REASONS, () => HttpResponse.json({ referralReasons: [] })),
      http.post(REASONS, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That code already exists', requestId: 'r1' } },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referral-reasons/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Code'), 'domestic_abuse');
    await user.type(screen.getByLabelText('Label'), 'Domestic abuse');
    await user.click(screen.getByRole('button', { name: 'Add reason' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code already exists');
  });
});
