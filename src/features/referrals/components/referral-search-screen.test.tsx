import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { ReferralSearchResult } from '../queries';

function result(overrides: Partial<ReferralSearchResult> = {}): ReferralSearchResult {
  return {
    referralId: 'r1',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereePostcode: 'GU23 4XX',
    refereePhone: '01483 123456',
    sessionDate: '2026-08-15',
    status: 'active',
    reasonId: 'reason-1',
    referrerName: 'Case Worker',
    referrerOrganisation: 'Guildford Borough Council',
    answers: { reasonAdditional: 'Rent arrears', Secondary: ['reason-2'] },
    adminInfo: 'Ring after 2pm',
    ...overrides,
  };
}

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'admin@example.org', displayName: 'Admin', role: 'admin' },
      }),
    ),
  );
});

const reasonsHandler = () =>
  http.get('/api/v1/referral-reasons', () =>
    HttpResponse.json({
      referralReasons: [
        {
          id: 'reason-1',
          code: 'low_income',
          label: 'Low income',
          displayOrder: 0,
          isActive: true,
        },
        {
          id: 'reason-2',
          code: 'domestic_abuse',
          label: 'Domestic abuse',
          displayOrder: 1,
          isActive: false,
        },
      ],
    }),
  );

describe('administrator referral search', () => {
  it('shows a compact, horizontally scrollable working-list row and an unheaded cause summary', async () => {
    let body: unknown;
    server.use(
      reasonsHandler(),
      http.post('/api/v1/referrals/search', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ count: 1, results: [result()] });
      }),
    );
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('DoB'), '1985-03-04');
    await user.type(screen.getByLabelText('or Postcode'), 'GU23 4XX');
    await user.type(screen.getByLabelText('or Phone number'), '01483 123456');
    await user.type(screen.getByLabelText('Start of surname'), 'Ro');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('link', { name: 'Rowe, Jamie' })).toHaveAttribute(
      'href',
      '/referrals/r1',
    );
    expect(screen.getByText(/15 Aug 2026/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('GU23 4XX')).toBeInTheDocument();
    expect(screen.getByText('01483 123456')).toBeInTheDocument();
    expect(screen.getByText('Guildford Borough Council')).toBeInTheDocument();
    expect(
      screen.getByText('Low income / Domestic abuse / Rent arrears / Ring after 2pm'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Main cause of referral/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Referral search results' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(body).toEqual({
      dateOfBirth: '1985-03-04',
      postcode: 'GU23 4XX',
      phone: '01483 123456',
      surnamePrefix: 'Ro',
    });
  });

  it('renders a row with no administrator notes as four items, not a ragged line', async () => {
    server.use(
      reasonsHandler(),
      http.post('/api/v1/referrals/search', () =>
        HttpResponse.json({ count: 1, results: [result({ adminInfo: null })] }),
      ),
    );
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('or Postcode'), 'GU23 4XX');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByText('Low income / Domestic abuse / Rent arrears / —'),
    ).toBeInTheDocument();
  });

  it('shows the same results again when an administrator comes back from a referral', async () => {
    server.use(
      reasonsHandler(),
      http.post('/api/v1/referrals/search', () =>
        HttpResponse.json({ count: 1, results: [result()] }),
      ),
    );
    const { queryClient } = renderApp('/referrals/search');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('DoB'), '1985-03-04');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('link', { name: 'Rowe, Jamie' });

    // Opening a result unmounts this screen; the same cache is what an
    // administrator comes back to, and the search itself never reaches a URL.
    cleanup();
    renderApp('/referrals/search', queryClient);

    expect(await screen.findByRole('link', { name: 'Rowe, Jamie' })).toBeInTheDocument();
    expect(await screen.findByLabelText('DoB')).toHaveValue('1985-03-04');
  });

  it('will not search on a surname start without an identifier', async () => {
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Start of surname'), 'Ro');
    expect(await screen.findByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('asks the administrator to narrow a search when the server capped the results', async () => {
    server.use(
      http.post('/api/v1/referrals/search', () => HttpResponse.json({ count: 51, results: [] })),
    );
    renderApp('/referrals/search');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('or Postcode'), 'GU23 4XX');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Showing the first 0 results');
  });
});
